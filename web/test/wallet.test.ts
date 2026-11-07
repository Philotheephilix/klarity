import { describe, it, expect, afterEach } from 'vitest';
import { connectWallet, ensureRabdiNetwork, signDescriptorWrite } from '../lib/wallet';

type Handler = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

function stubEthereum(handler: Handler) {
  (globalThis as unknown as { window: { ethereum?: unknown } }).window = {
    ethereum: { request: handler },
  };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const MESSAGE = {
  descriptorHash: ('0x' + '1'.repeat(64)) as `0x${string}`,
  deadline: '1700000000',
  nonce: '42',
  action: 'create',
};

describe('connectWallet', () => {
  it('returns the first account, lowercased', async () => {
    stubEthereum(async (args) => {
      if (args.method === 'eth_requestAccounts') {
        return ['0xABCDef0000000000000000000000000000000001'];
      }
      throw new Error(`unexpected ${args.method}`);
    });
    const addr = await connectWallet();
    expect(addr).toBe('0xabcdef0000000000000000000000000000000001');
  });

  it('throws a clear error when no wallet is present', async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    await expect(connectWallet()).rejects.toThrow(/no browser wallet/i);
  });

  it('throws when the wallet returns no accounts', async () => {
    stubEthereum(async () => []);
    await expect(connectWallet()).rejects.toThrow(/no accounts/i);
  });
});

describe('signDescriptorWrite', () => {
  it('calls eth_signTypedData_v4 with DescriptorWrite + EIP712Domain and returns the sig', async () => {
    let seen: { method: string; params?: unknown[] } | null = null;
    stubEthereum(async (args) => {
      seen = args;
      return '0x' + 'ab'.repeat(32);
    });
    const sig = await signDescriptorWrite(
      '0xabcdef0000000000000000000000000000000001',
      MESSAGE,
    );
    expect(sig).toBe('0x' + 'ab'.repeat(32));
    expect(seen!.method).toBe('eth_signTypedData_v4');
    const [addr, json] = seen!.params as [string, string];
    expect(addr).toBe('0xabcdef0000000000000000000000000000000001');
    const typed = JSON.parse(json);
    // EIP712Domain MUST be present for the raw RPC (viem derives it; MetaMask does not).
    expect(typed.types.EIP712Domain).toBeDefined();
    expect(typed.primaryType).toBe('DescriptorWrite');
    expect(typed.domain.chainId).toBe(7794095);
    expect(typed.message).toEqual(MESSAGE);
  });

  it('rejects a non-0x signature from the wallet', async () => {
    stubEthereum(async () => 'not-a-sig');
    await expect(
      signDescriptorWrite('0xabc', MESSAGE),
    ).rejects.toThrow(/invalid signature/i);
  });

  it('throws when no wallet is present', async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    await expect(signDescriptorWrite('0xabc', MESSAGE)).rejects.toThrow(
      /no browser wallet/i,
    );
  });
});

describe('ensureRabdiNetwork', () => {
  it('returns early without switching when already on Rabdi (case-insensitive)', async () => {
    const seen: string[] = [];
    stubEthereum(async (args) => {
      seen.push(args.method);
      if (args.method === 'eth_requestAccounts') return ['0xabc'];
      if (args.method === 'eth_chainId') return '0x76EDAF';
      throw new Error(`unexpected ${args.method}`);
    });
    await ensureRabdiNetwork();
    expect(seen).toEqual(['eth_requestAccounts', 'eth_chainId']);
  });

  it('calls wallet_switchEthereumChain when on a non-Rabdi chain', async () => {
    const seen: { method: string; params?: unknown[] }[] = [];
    stubEthereum(async (args) => {
      seen.push(args);
      if (args.method === 'eth_requestAccounts') return ['0xabc'];
      if (args.method === 'eth_chainId') return '0x1';
      if (args.method === 'wallet_switchEthereumChain') return null;
      throw new Error(`unexpected ${args.method}`);
    });
    await ensureRabdiNetwork();
    const methods = seen.map((s) => s.method);
    expect(methods).toContain('wallet_switchEthereumChain');
    expect(methods).not.toContain('wallet_addEthereumChain');
    const sw = seen.find((s) => s.method === 'wallet_switchEthereumChain');
    expect((sw!.params as [{ chainId: string }])[0].chainId).toBe('0x76edaf');
  });

  it('adds the chain when switch throws 4902, then switches', async () => {
    const seen: string[] = [];
    stubEthereum(async (args) => {
      seen.push(args.method);
      if (args.method === 'eth_requestAccounts') return ['0xabc'];
      if (args.method === 'eth_chainId') return '0x1';
      if (args.method === 'wallet_switchEthereumChain') {
        if (seen.filter((m) => m === 'wallet_switchEthereumChain').length === 1) {
          throw { code: 4902, message: 'Unrecognized chain ID' };
        }
        return null;
      }
      if (args.method === 'wallet_addEthereumChain') return null;
      throw new Error(`unexpected ${args.method}`);
    });
    await ensureRabdiNetwork();
    expect(seen).toContain('wallet_addEthereumChain');
    // add happens after the first failed switch.
    expect(seen.indexOf('wallet_addEthereumChain')).toBeGreaterThan(
      seen.indexOf('wallet_switchEthereumChain'),
    );
  });

  it('surfaces a readable message when the user rejects the switch (4001)', async () => {
    stubEthereum(async (args) => {
      if (args.method === 'eth_requestAccounts') return ['0xabc'];
      if (args.method === 'eth_chainId') return '0x1';
      if (args.method === 'wallet_switchEthereumChain') {
        throw { code: 4001, message: 'User rejected the request.' };
      }
      throw new Error(`unexpected ${args.method}`);
    });
    await expect(ensureRabdiNetwork()).rejects.toThrow(/declined the network switch to rabdi/i);
  });

  it('surfaces an authorization message when the switch throws 4100', async () => {
    stubEthereum(async (args) => {
      if (args.method === 'eth_requestAccounts') return ['0xabc'];
      if (args.method === 'eth_chainId') return '0x1';
      if (args.method === 'wallet_switchEthereumChain') {
        throw { code: 4100, message: 'account/method not authorized' };
      }
      throw new Error(`unexpected ${args.method}`);
    });
    await expect(ensureRabdiNetwork()).rejects.toThrow(/not authorized/i);
  });
});
