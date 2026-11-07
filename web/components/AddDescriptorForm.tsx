'use client';

import { useState } from 'react';
import Link from 'next/link';
import { makeApi } from '../lib/config';
import { descriptorHash } from '../lib/descriptor-hash';
import {
  connectWallet,
  ensureRabdiNetwork,
  signDescriptorWrite,
} from '../lib/wallet';
import { IconArrowUpRight } from './icons';
import { useToast } from './Toasts';
import type { CreateDescriptorResponse } from '../lib/types';

interface FieldRow {
  label: string;
  path: string;
  format: string;
}

const EMPTY_FIELD: FieldRow = { label: '', path: '', format: 'raw' };

// One-click example: the Uniswap Universal Router `execute` descriptor (the same
// literal used by scripts/submit-ur-descriptor.mjs). Lets a user see a complete,
// valid form without hand-typing a contract + signature + fields.
const UNISWAP_EXAMPLE = {
  chainId: '1',
  contract: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af',
  owner: 'Uniswap',
  signature: 'execute(bytes commands, bytes[] inputs, uint256 deadline)',
  intent: 'Universal Router batch',
  path: 'registry/uniswap/calldata-UniversalRouter.json',
  fields: [
    { label: 'Commands', path: 'commands', format: 'raw' },
    { label: 'Inputs (count)', path: 'inputs.[]', format: 'raw' },
    { label: 'Deadline', path: 'deadline', format: 'raw' },
  ] as FieldRow[],
};


/**
 * Assemble the stored-shape descriptor object from the form inputs. Mirrors the
 * literal in scripts/submit-ur-descriptor.mjs: context.contract.deployments +
 * metadata.owner + display.formats[signature] with __signature and fields.
 */
function buildDescriptor(input: {
  chainId: number;
  contract: string;
  owner: string;
  signature: string;
  intent: string;
  fields: FieldRow[];
}): object {
  return {
    context: {
      contract: {
        deployments: [
          { chainId: input.chainId, address: input.contract.toLowerCase() },
        ],
      },
    },
    metadata: { owner: input.owner },
    display: {
      formats: {
        [input.signature]: {
          __signature: input.signature,
          intent: input.intent,
          fields: input.fields.map((f) => ({
            label: f.label,
            path: f.path,
            format: f.format || 'raw',
          })),
        },
      },
    },
  };
}

export function AddDescriptorForm() {
  const toast = useToast();
  const [wallet, setWallet] = useState<string | null>(null);
  const [chainId, setChainId] = useState('1');
  const [contract, setContract] = useState('');
  const [owner, setOwner] = useState('');
  const [signature, setSignature] = useState('');
  const [intent, setIntent] = useState('');
  const [path, setPath] = useState('');
  const [fields, setFields] = useState<FieldRow[]>([{ ...EMPTY_FIELD }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateDescriptorResponse | null>(null);

  function updateField(i: number, key: keyof FieldRow, value: string) {
    setFields((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)),
    );
  }

  function fillUniswapExample() {
    setChainId(UNISWAP_EXAMPLE.chainId);
    setContract(UNISWAP_EXAMPLE.contract);
    setOwner(UNISWAP_EXAMPLE.owner);
    setSignature(UNISWAP_EXAMPLE.signature);
    setIntent(UNISWAP_EXAMPLE.intent);
    setPath(UNISWAP_EXAMPLE.path);
    setFields(UNISWAP_EXAMPLE.fields.map((f) => ({ ...f })));
    setError(null);
    setResult(null);
    toast.show('Filled the Uniswap Universal Router example.');
  }

  async function onConnect() {
    setError(null);
    try {
      const addr = await connectWallet();
      setWallet(addr);
      toast.show(`Wallet connected: ${addr.slice(0, 6)}…${addr.slice(-4)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!wallet) {
      setError('Connect a wallet first.');
      return;
    }
    const chainNum = Number(chainId);
    if (!Number.isInteger(chainNum) || chainNum <= 0) {
      setError('chainId must be a positive integer.');
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract.trim())) {
      setError('Contract must be a 0x-prefixed 20-byte address.');
      return;
    }
    if (!signature.trim()) {
      setError('Function signature is required.');
      return;
    }
    const cleanFields = fields.filter((f) => f.label.trim() && f.path.trim());
    if (cleanFields.length === 0) {
      setError('Add at least one field (label + path).');
      return;
    }

    setBusy(true);
    try {
      // Align the wallet's active chain with the write target before signing.
      // This is a UX guarantee, not a cryptographic one — the EIP-712 domain
      // already pins chainId 7794095 regardless of the wallet's active network.
      toast.show('Checking network…');
      await ensureRabdiNetwork();

      const descriptor = buildDescriptor({
        chainId: chainNum,
        contract: contract.trim(),
        owner: owner.trim() || 'unknown',
        signature: signature.trim(),
        intent: intent.trim(),
        fields: cleanFields,
      });

      // Same hash the server verifies; same message shape as the submit script.
      const hash = descriptorHash(descriptor);
      const message = {
        descriptorHash: hash,
        deadline: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: String(Date.now()),
        action: 'create',
      };

      toast.show('Sign the write in your wallet…');
      const sigHex = await signDescriptorWrite(wallet, message);

      const resolvedPath =
        path.trim() ||
        `registry/${(owner.trim() || 'unknown').toLowerCase()}/calldata-descriptor.json`;

      const res = await makeApi().createDescriptor({
        path: resolvedPath,
        descriptor,
        message,
        signature: sigHex,
      });
      setResult(res);
      toast.show('Descriptor written — PR opened.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-form" onSubmit={onSubmit}>
      <div className="add-wallet-row">
        {wallet ? (
          <span className="add-wallet-chip" title={wallet}>
            Connected: {wallet.slice(0, 6)}…{wallet.slice(-4)}
          </span>
        ) : (
          <button
            type="button"
            className="dash-btn dash-btn-primary"
            onClick={onConnect}
          >
            Connect wallet
          </button>
        )}
        <button
          type="button"
          className="dash-btn dash-btn-ghost"
          onClick={fillUniswapExample}
        >
          Fill Uniswap example
        </button>
      </div>

      <div className="add-grid">
        <label className="add-label">
          Chain ID
          <input
            className="add-input"
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
            inputMode="numeric"
            placeholder="1"
          />
        </label>
        <label className="add-label">
          Owner
          <input
            className="add-input"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Uniswap"
          />
        </label>
      </div>

      <label className="add-label">
        Contract address
        <input
          className="add-input"
          value={contract}
          onChange={(e) => setContract(e.target.value)}
          placeholder="0x…"
          autoComplete="off"
        />
      </label>

      <label className="add-label">
        Function signature
        <input
          className="add-input"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="execute(bytes commands, bytes[] inputs, uint256 deadline)"
          autoComplete="off"
        />
      </label>

      <label className="add-label">
        Intent
        <input
          className="add-input"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="Universal Router batch"
        />
      </label>

      <label className="add-label">
        Registry path <span className="add-hint">(optional)</span>
        <input
          className="add-input"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="registry/uniswap/calldata-UniversalRouter.json"
          autoComplete="off"
        />
      </label>

      <div className="add-fields">
        <div className="add-fields-head">
          <span>Fields</span>
          <button
            type="button"
            className="dash-btn dash-btn-ghost add-mini"
            onClick={() => setFields((prev) => [...prev, { ...EMPTY_FIELD }])}
          >
            + Add field
          </button>
        </div>
        {fields.map((f, i) => (
          <div className="add-field-row" key={i}>
            <input
              className="add-input"
              value={f.label}
              onChange={(e) => updateField(i, 'label', e.target.value)}
              placeholder="Label (e.g. Commands)"
            />
            <input
              className="add-input"
              value={f.path}
              onChange={(e) => updateField(i, 'path', e.target.value)}
              placeholder="Path (e.g. commands)"
            />
            <input
              className="add-input add-input-narrow"
              value={f.format}
              onChange={(e) => updateField(i, 'format', e.target.value)}
              placeholder="raw"
            />
            <button
              type="button"
              className="add-field-del"
              aria-label="Remove field"
              onClick={() =>
                setFields((prev) =>
                  prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev,
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {error ? <div className="add-error">{error}</div> : null}

      {result ? (
        <div className="add-success">
          <div className="add-success-title">Descriptor written</div>
          <div className="add-success-row">
            <span>Entity key</span>
            <code>{result.entityKey}</code>
          </div>
          <div className="add-success-row">
            <span>Tx hash</span>
            <code>{result.txHash}</code>
          </div>
          {result.attested ? (
            <div className="add-success-row">
              <span>Attestation</span>
              <code>{result.attestationUID ?? 'attested'}</code>
            </div>
          ) : null}
          <a
            className="dash-btn dash-btn-primary add-pr-link"
            href={result.prUrl}
            target="_blank"
            rel="noreferrer"
          >
            View pull request
            <IconArrowUpRight size={16} />
          </a>
        </div>
      ) : null}

      <button
        type="submit"
        className="dash-btn dash-btn-primary add-submit"
        disabled={busy || !wallet}
      >
        {busy ? 'Submitting…' : 'Sign & submit'}
      </button>

      <p className="add-foot">
        The connected wallet signs an EIP-712 write; only an allowlisted wallet
        is accepted. A successful write mirrors to the registry and opens a PR.{' '}
        <Link href="/docs">How writes are authorized</Link>
      </p>
    </form>
  );
}
