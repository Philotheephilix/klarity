import Link from 'next/link';
import { Card } from '../../components/Card';

/**
 * API reference for the Klarity read API. Documents only the endpoints that
 * actually exist: the read-only query routes (src/routes/query.ts) and the
 * clear-signing decode route (src/routes/decode.ts), matched to the client
 * contract in web/lib/api.ts. Server component — no interactivity needed.
 */

const codeBlockStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '16px',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  fontSize: '13px',
  margin: '10px 0 0',
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre style={codeBlockStyle}>
      <code>{children}</code>
    </pre>
  );
}

const LIST_EXAMPLE = `GET {API_BASE}/descriptors?chainId=1&entityName=1inch

[
  {
    "chainId": 1,
    "contract": "0x1111111254eeb25477b68fb85 ed929f73a960582",
    "selector": "0x12aa3caf",
    "functionName": "swap",
    "kind": "calldata",
    "intent": "Swap tokens",
    "entityName": "1inch",
    "contractName": "AggregationRouterV5",
    "owner": "0x...",
    "sourcePath": "1inch/calldata-swap.json",
    "schemaVersion": "1"
  }
]`;

const CONTRACT_EXAMPLE = `GET {API_BASE}/descriptors/1/0x1111111254eeb25477b68fb85ed929f73a960582

[ { "chainId": 1, "contract": "0x1111...", "selector": "0x12aa3caf", ... } ]`;

const SINGLE_EXAMPLE = `GET {API_BASE}/descriptors/1/0x1111111254eeb25477b68fb85ed929f73a960582/0x12aa3caf

{
  "chainId": 1,
  "contract": "0x1111...",
  "selector": "0x12aa3caf",
  "functionName": "swap",
  "kind": "calldata",
  "intent": "Swap tokens",
  "entityName": "1inch",
  "contractName": "AggregationRouterV5",
  "owner": "0x...",
  "sourcePath": "1inch/calldata-swap.json",
  "schemaVersion": "1",
  "$key": "1:0x1111...:0x12aa3caf",
  "formatBlock": { "...": "decoded ERC-7730 format block" },
  "verified": {
    "efApproved": true,
    "efAttester": "0x...",
    "efAttestationUID": "0x...",
    "publicVouches": 0,
    "rankedAttesters": []
  }
}`;

const DECODE_REQUEST = `POST {API_BASE}/decode
Content-Type: application/json

{
  "chainId": 1,
  "contract": "0x1111111254eeb25477b68fb85ed929f73a960582",
  "calldata": "0x12aa3caf..."
}`;

const DECODE_RESPONSE = `{
  "signing": {
    "chainId": 1,
    "contract": "0x1111...",
    "selector": "0x12aa3caf",
    "kind": "calldata",
    "decodedFrom": "calldata",
    "contractName": "AggregationRouterV5",
    "functionName": "swap",
    "functionSignature": "swap(address executor, (address,address,...) desc, bytes data)",
    "intent": "Swap tokens",
    "interpolatedIntent": "Swap 100 USDC for ETH",
    "summary": "Swap 100 USDC for ETH"
  },
  "fields": [
    {
      "label": "Amount",
      "path": "desc.amount",
      "format": "tokenAmount",
      "hidden": false,
      "value": "100000000",
      "type": "uint256"
    }
  ],
  "hiddenFields": [],
  "note": "Labels and intent come from the ERC-7730 descriptor; argument values are ABI-decoded from the calldata.",
  "raw": { "calldata": "0x12aa3caf..." },
  "functionSignature": "swap(address executor, (address,address,...) desc, bytes data)"
}`;

export default function DocsPage() {
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Docs</span>
      </nav>
      <div className="page-head">
        <h1 className="page-title page-title-xl">API Reference</h1>
        <p className="page-sub">
          The Klarity read API exposes the mirrored ERC-7730 clear-signing
          registry: list and look up descriptors, and decode a call into its
          human-readable clear-signing view. All responses are JSON.
        </p>
        <p className="page-sub">
          Every path below is relative to the API base. The web client resolves
          it from the <code>NEXT_PUBLIC_KLARITY_API_BASE</code> environment
          variable (see <code>web/lib/api.ts</code>), shown as{' '}
          <code>{'{API_BASE}'}</code> in the examples.
        </p>
      </div>

      <div className="docs-list">
        <Card>
          <div className="card-pad">
            <div className="card-title">GET /descriptors</div>
            <p className="card-note">
              List mirrored descriptors matching one or more filters. A
              filterless query is rejected with <code>400</code>, so at least
              one filter is required. Returns an array of descriptor rows.
            </p>
            <p className="card-note">
              Accepted filter query params: <code>chainId</code> (numeric),{' '}
              <code>contract</code>, <code>selector</code>, <code>kind</code>,{' '}
              <code>intent</code>, <code>entityName</code>,{' '}
              <code>contractName</code>, <code>functionName</code>,{' '}
              <code>owner</code>, <code>sourcePath</code>, <code>source</code>,{' '}
              <code>eip712PrimaryType</code>. Unknown params are ignored.
            </p>
            <CodeBlock>{LIST_EXAMPLE}</CodeBlock>
          </div>
        </Card>

        <Card>
          <div className="card-pad">
            <div className="card-title">
              GET /descriptors/:chainId/:address
            </div>
            <p className="card-note">
              All descriptors mirrored for a single contract on a chain.{' '}
              <code>chainId</code> must be numeric; <code>address</code> is the
              0x contract address. Returns an array of descriptor rows (empty if
              none).
            </p>
            <CodeBlock>{CONTRACT_EXAMPLE}</CodeBlock>
          </div>
        </Card>

        <Card>
          <div className="card-pad">
            <div className="card-title">
              GET /descriptors/:chainId/:address/:selector
            </div>
            <p className="card-note">
              A single descriptor identified by chain, contract address and
              4-byte <code>selector</code>. Returns the descriptor row plus a
              decoded <code>formatBlock</code> and a <code>verified</code> trust
              block; <code>404</code> if no such descriptor exists.
            </p>
            <CodeBlock>{SINGLE_EXAMPLE}</CodeBlock>
          </div>
        </Card>

        <Card>
          <div className="card-pad">
            <div className="card-title">POST /decode</div>
            <p className="card-note">
              Decode a call into its clear-signing view drawn from the mirrored
              ERC-7730 descriptor. The request body is a <code>DecodeRequest</code>:
              required <code>chainId</code> (number) and <code>contract</code>{' '}
              (0x 20-byte address), plus either raw <code>calldata</code>{' '}
              (0x-hex with a 4-byte selector) or an EIP-712{' '}
              <code>typedData</code> payload. An optional <code>selector</code>{' '}
              overrides selector derivation for typedData. Responds{' '}
              <code>404</code> if no descriptor matches the derived selector.
            </p>
            <CodeBlock>{DECODE_REQUEST}</CodeBlock>
            <p className="card-note">
              The <code>DecodeResponse</code> carries a <code>signing</code>{' '}
              summary (including <code>functionSignature</code> when the
              descriptor is name-bearing), the visible <code>fields</code> and{' '}
              <code>hiddenFields</code>, a human-readable <code>note</code>, and
              the <code>raw</code> input echoed back. When the input is raw
              calldata and a function signature is known, each field is
              additionally resolved to its ABI-decoded <code>value</code> and{' '}
              <code>type</code> (best-effort — labels-only if a field does not
              resolve).
            </p>
            <CodeBlock>{DECODE_RESPONSE}</CodeBlock>
          </div>
        </Card>

        <Card>
          <div className="card-pad">
            <div className="card-title">Not part of the public read API</div>
            <p className="card-note">
              Signed write submission and the registry webhook exist on the
              server but are authenticated / internal and are not part of this
              read API. Their contracts are intentionally omitted here.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
