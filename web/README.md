# Klarity Content Explorer

A dark, read-only explorer for the ERC-7730 clear-signing corpus mirrored by
Klarity. Browse companies to contracts to calls, and for each call see the raw
calldata a wallet would otherwise sign blind beside the same call rendered as
clear-signing from its ERC-7730 descriptor.

This app is strictly client-side and read-only. It makes no writes, adds no
backend endpoints, and only reads the four documented Klarity routes. The sample
payloads it sends to `/decode` are synthetic placeholders for illustration, not
real transactions to sign; argument values are never ABI-decoded.

## Run

```
cd web
npm install
cp .env.example .env.local      # then edit NEXT_PUBLIC_KLARITY_API_BASE
npm run dev
```

Open http://localhost:3000.

## Configuration

`NEXT_PUBLIC_KLARITY_API_BASE` (required) is the origin of the Klarity API, with
no trailing slash, e.g. `http://localhost:8787`. If it is unset the pages render
an error card explaining what to set.

## CORS

The explorer runs on a **separate origin** from the Klarity API and calls it
directly from the browser. The Klarity API must therefore send CORS headers that
allow the explorer's origin (`Access-Control-Allow-Origin`, plus the usual
preflight headers for the `POST /decode` request). There is no server-side proxy
in this app.

## API routes used

- `GET /descriptors?entityName=<org>` — contracts for a company. A filterless
  `/descriptors` call is never issued (the API requires at least one filter).
- `GET /descriptors/:chainId/:address` — calls for a contract.
- `GET /descriptors/:chainId/:address/:selector` — a single descriptor.
- `POST /decode` — render a (sample) payload as clear-signing.

## Test

```
cd web
npm test        # vitest run
npm run build   # production build
```
