/**
 * Companion dapp glue: connect -> install Snap -> poll receipt -> invoke rank.
 *
 * This file is intentionally thin. All non-trivial logic lives in poll.ts so it
 * can be unit-tested; here we only wire DOM inputs to `window.ethereum` and to
 * the polling helper. No private keys are ever requested or handled: every
 * signature is produced inside MetaMask.
 */
import { waitForReceipt } from './poll.js';

// Companion-local ambient type for the injected provider. Confined to this dir;
// the root/snap tsconfig strictness is untouched. The `any` return is scoped
// to this one declaration.
declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] | object }): Promise<any>;
    };
  }
}

type El = HTMLInputElement;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

function setStatus(msg: string): void {
  byId<HTMLPreElement>('status').textContent = msg;
}

function requireEthereum(): NonNullable<Window['ethereum']> {
  const eth = window.ethereum;
  if (!eth) {
    throw new Error('No injected provider found. Install MetaMask Flask.');
  }
  return eth;
}

async function run(): Promise<void> {
  const eth = requireEthereum();

  const snapId = byId<El>('snapId').value.trim();
  const apiBase = byId<El>('apiBase').value.trim();
  const chainId = Number(byId<El>('chainId').value.trim());
  const contract = byId<El>('contract').value.trim();
  const selector = byId<El>('selector').value.trim();
  const txHash = byId<El>('txHash').value.trim();

  setStatus('Connecting to MetaMask...');
  const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
  const account = accounts[0];
  if (!account) throw new Error('No account authorized.');

  setStatus(`Installing Snap ${snapId}...`);
  await eth.request({
    method: 'wallet_requestSnaps',
    params: { [snapId]: {} },
  });

  setStatus(`Waiting for receipt of ${txHash}...`);
  const result = await waitForReceipt(txHash, {
    getReceipt: (h) =>
      eth.request({ method: 'eth_getTransactionReceipt', params: [h] }),
  });

  if (!result.mined) {
    setStatus('Transaction not mined within the polling window. Try again later.');
    return;
  }

  setStatus(`Mined (status ${result.status}). Invoking ranking vouch...`);
  const rank = await eth.request({
    method: 'wallet_invokeSnap',
    params: {
      snapId,
      request: {
        method: 'klarity_rank',
        params: {
          chainId,
          contract,
          selector,
          interactionTxHash: txHash,
          account,
        },
      },
    },
  });

  setStatus(`Done. API base ${apiBase}\n${JSON.stringify(rank, null, 2)}`);
}

function main(): void {
  byId<HTMLButtonElement>('connect').addEventListener('click', () => {
    run().catch((err: unknown) => {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });
}

main();
