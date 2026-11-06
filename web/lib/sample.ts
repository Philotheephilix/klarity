import type { DecodeRequest, DescriptorRow } from './types';

// All sample payloads here are SYNTHETIC placeholders used only to drive the
// /decode endpoint for illustration. They are not real on-chain calldata and
// never represent a transaction a user should sign. Generation is fully
// deterministic (seeded from the selector) so the UI renders stably.

function cleanHex(selector: string): string {
  return selector.replace(/^0x/, '').toLowerCase().padStart(8, '0').slice(0, 8);
}

// A 32-byte (64-hex) word derived deterministically from the selector and word
// index, with no randomness.
function deriveWord(seed: string, index: number): string {
  let out = '';
  let n = 0;
  while (out.length < 64) {
    const code = seed.charCodeAt(n % seed.length);
    const mixed = (code + index * 7 + n * 13) & 0xff;
    out += mixed.toString(16).padStart(2, '0');
    n += 1;
  }
  return out.slice(0, 64);
}

export function sampleCalldata(selector: string, argCount = 2): string {
  const sel = cleanHex(selector);
  let body = '';
  for (let i = 0; i < argCount; i += 1) {
    body += deriveWord(sel, i);
  }
  return `0x${sel}${body}`;
}

export function sampleDecodeRequest(row: DescriptorRow): DecodeRequest {
  if (row.kind === 'eip712') {
    const primaryType = row.eip712PrimaryType ?? row.functionName ?? 'Message';
    return {
      chainId: row.chainId,
      contract: row.contract,
      selector: row.selector,
      typedData: {
        primaryType,
        domain: {
          name: row.contractName,
          chainId: row.chainId,
          verifyingContract: row.contract,
        },
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          [primaryType]: [{ name: 'field', type: 'uint256' }],
        },
        message: { field: '0' },
      },
    };
  }
  return {
    chainId: row.chainId,
    contract: row.contract,
    calldata: sampleCalldata(row.selector),
  };
}
