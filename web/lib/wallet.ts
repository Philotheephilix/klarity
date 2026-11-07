// Minimal browser-wallet (MetaMask) wrapper for the add-descriptor flow.
//
// Two operations: connect (eth_requestAccounts) and sign an EIP-712
// DescriptorWrite (eth_signTypedData_v4). The signing wallet IS the auth
// identity — the server verifies the recovered signer is in AUTHORIZED_WALLETS.
//
// Defensive: throws a clear Error when no injected provider is present, and
// lowercases the returned address so it matches the server's allowlist compare.

/** The sliver of EIP-1193 we use. */
interface MinimalEthereum {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: MinimalEthereum;
  }
}

/** The DescriptorWrite message the server's EIP-712 types expect. */
export interface DescriptorWriteMessage {
  descriptorHash: `0x${string}`;
  deadline: string;
  nonce: string;
  action: string;
}

// Fixed EIP-712 domain + types — copied verbatim from src/auth.ts. The chainId
// is the Arkiv/Rabdi chain (7794095), NOT the wallet's connected network; writes
// are authorized off-chain so there is no verifyingContract.
const DOMAIN = {
  name: 'Klarity ClearSign Registry',
  version: '1',
  chainId: 7794095,
} as const;

function getProvider(): MinimalEthereum {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error(
      'No browser wallet found. Install MetaMask (or another EIP-1193 wallet) and reload.',
    );
  }
  return window.ethereum;
}

// Rabdi (Arkiv Rabdi testnet) network identity. chainId 7794095 === 0x76edaf.
// The hex is what the wallet RPC speaks; the decimal matches DOMAIN.chainId above.
const RABDI_CHAIN_ID_HEX = '0x76edaf';

// RPC endpoint is overridable via env so it isn't hardcoded-only; the public
// Rabdi endpoint is the default. (Public URL, not a credential.)
const RABDI_RPC_URL =
  process.env.NEXT_PUBLIC_RABDI_RPC_URL ??
  'https://rpc.rabdi.db-chain.testnet.arkiv.network';

/** Full params for wallet_addEthereumChain when Rabdi isn't in the wallet yet. */
const RABDI_PARAMS = {
  chainId: RABDI_CHAIN_ID_HEX,
  chainName: 'Arkiv Rabdi Testnet',
  rpcUrls: [RABDI_RPC_URL],
  nativeCurrency: { name: 'Arkiv', symbol: 'ARK', decimals: 18 },
  blockExplorerUrls: [] as string[],
} as const;

/** Read a numeric EIP-1193 error `code` off an unknown thrown value. */
function errorCode(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return undefined;
}

/** Best-effort message string from an unknown thrown value. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(e);
}

/**
 * Ensure the wallet's active chain is Rabdi, switching (and adding, if needed)
 * when it isn't. Returns once the switch has been requested successfully.
 *
 * NOTE: switching to Rabdi is a UX guarantee the product wants, NOT a
 * cryptographic requirement. eth_signTypedData_v4 signs regardless of the
 * wallet's active chain because the EIP-712 domain carries chainId: 7794095 in
 * the payload (see DOMAIN above). The switch only aligns the user's wallet
 * context with the chain the write targets.
 */
export async function ensureRabdiNetwork(): Promise<void> {
  const provider = getProvider();

  // Make sure the dapp is authorized for this account before any wallet_* call.
  // eth_requestAccounts is idempotent: it returns instantly if already
  // connected, or prompts otherwise. Without this, a prior session that was
  // locked / had its permission dropped makes wallet_switchEthereumChain fail
  // with 4100 ("account/method not authorized").
  await provider.request({ method: 'eth_requestAccounts' });

  const current = (await provider.request({
    method: 'eth_chainId',
  })) as string;
  if (current.toLowerCase() === RABDI_CHAIN_ID_HEX) {
    return;
  }

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: RABDI_CHAIN_ID_HEX }],
    });
  } catch (e) {
    // 4001 = user rejected the request.
    if (errorCode(e) === 4001) {
      throw new Error('You declined the network switch to Rabdi.');
    }
    // 4100 = the account/method is not authorized for this dapp. Ask the user
    // to reconnect/approve rather than failing with an opaque RPC error.
    if (errorCode(e) === 4100) {
      throw new Error(
        'Wallet not authorized. Open MetaMask, connect this site to your account, and try again.',
      );
    }
    // 4902 (or the generic "Unrecognized chain ID") = chain not in the wallet;
    // add it, then switch to it.
    if (errorCode(e) === 4902 || /unrecognized chain id/i.test(errorMessage(e))) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [RABDI_PARAMS],
      });
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: RABDI_CHAIN_ID_HEX }],
      });
      return;
    }
    throw new Error(
      `Failed to switch the wallet to the Rabdi network: ${errorMessage(e)}`,
    );
  }
}

/**
 * Prompt the wallet to connect and return the selected account, lowercased.
 * Throws when no provider is present or the user rejects the request.
 */
export async function connectWallet(): Promise<string> {
  const provider = getProvider();
  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('Wallet returned no accounts.');
  }
  return accounts[0].toLowerCase();
}

/**
 * Sign a DescriptorWrite with the connected `address` via eth_signTypedData_v4.
 *
 * Builds the FULL typed-data JSON including the EIP712Domain type entry — the
 * raw RPC requires it explicitly (unlike viem, which derives it). Returns the
 * 0x-prefixed signature the server's verifyWrite recovers the signer from.
 */
export async function signDescriptorWrite(
  address: string,
  message: DescriptorWriteMessage,
): Promise<`0x${string}`> {
  const provider = getProvider();
  const typedData = {
    domain: DOMAIN,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      DescriptorWrite: [
        { name: 'descriptorHash', type: 'bytes32' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'action', type: 'string' },
      ],
    },
    primaryType: 'DescriptorWrite',
    message,
  };
  const sig = (await provider.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(typedData)],
  })) as string;
  if (typeof sig !== 'string' || !sig.startsWith('0x')) {
    throw new Error('Wallet returned an invalid signature.');
  }
  return sig as `0x${string}`;
}
