# Klarity MetaMask Snap

A MetaMask Snap that clear-signs transactions to Klarity-known contracts and
prompts for a reputation rank after a transaction mines.

This Snap is an HTTP **client** of the existing Klarity TypeScript (Fastify)
server under `src/`. It adds **no new backend**. It talks to that server over
HTTP and defaults to `http://127.0.0.1:3000` (see `snap/src/config.ts`,
`getApiBaseUrl`).

MetaMask Flask is the developer build of the MetaMask **browser extension** (it
is not Python Flask). Snaps only install in Flask, not in release MetaMask.

## Running the live-test loop in MetaMask Flask

1. **Install MetaMask Flask.** Install the MetaMask Flask browser extension (the
   developer build) and complete its onboarding. Keep release MetaMask disabled
   for the test profile to avoid conflicts.

2. **Start the existing Klarity server.** This lane adds no server. From the
   repository root start the server that already exists under `src/`:

   ```
   npm run dev
   ```

   It listens on `http://127.0.0.1:3000`, which is the Snap default. Do not
   invent a new server; the Snap only consumes the existing one.

3. **Build the Snap bundle.**

   ```
   cd snap && npm install && npm run build
   ```

4. **Serve the companion page.** The companion under `snap/companion/` is a
   static page used to connect to the Snap for local testing. Serve it with any
   static file server, for example:

   ```
   cd snap/companion && npx serve .
   ```

   Open the served page, click connect, and install the Snap when Flask
   prompts.

5. **Exercise the flow.** Submit a Sepolia transaction to a Klarity-known
   contract.
   - Before signing, observe the clear-signing insight panel rendered by the
     Snap's `onTransaction` handler.
   - After the transaction mines, observe the post-transaction rank prompt
     driven by the `klarity_rank` RPC method and its dialog.

## Human-gated Sepolia public-tier schema registration

Live vouch submission is **human-gated**. This repository and its code do
**not** register any EAS schema and make **no** live EAS or Arkiv write.

To enable LIVE vouches, a human must:

1. Manually **register the public-tier EAS schema** on Sepolia. The schema
   string is exactly:

   ```
   bytes32 descriptorHash,address contract,uint256 chainId,bytes32 interactionTxHash
   ```

2. Take the `publicSchemaUID` returned by that registration and inject it into
   the active profile at runtime using `withPublicSchemaUID` from
   `snap/src/config.ts`:

   ```ts
   import { SEPOLIA } from '@klarity/sdk';
   import { withPublicSchemaUID } from './config.js';

   // uid is the human-approved UID from the manual Sepolia registration above.
   const profile = withPublicSchemaUID(SEPOLIA, uid);
   ```

   `withPublicSchemaUID` only injects a caller-supplied value. It returns a new
   profile and never hard-codes, fabricates, or mutates a UID.

Until a human completes this step, `publicSchemaUID` stays `''`. In that state
the vouch path is dry-run / mock-gated: because `publicSchemaUID === ''` it will
**refuse to submit** with "public schema not registered". No live attestation is
ever produced by this code on its own.
