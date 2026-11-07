/**
 * Insight renderer — turns a `DecodeResponse` (+ optional `VerifiedBlock`) into
 * the JSX tree shown in the MetaMask Snaps transaction-insight panel.
 *
 * This is the user-facing clear-signing view. It is deliberately HONEST and
 * LITERAL:
 *   - It prints field LABELS only, never decoded argument values, so it can
 *     never misrepresent what a transaction does.
 *   - It reproduces the server's `note` verbatim.
 *   - Its trust line says "EF-attested" only when the EF gate actually approved
 *     the descriptor; otherwise "Not EF-attested". It never uses the words
 *     "safe", "verified", or "trusted" for an unattested descriptor.
 *   - It contains no emoji.
 *
 * The Snap is a CLIENT of the Klarity server; this module never decodes or
 * re-derives trust — it only renders what the SDK handed it.
 */
import type { DecodeResponse, SigningField, VerifiedBlock } from '@klarity/sdk';
import type { GenericSnapElement } from '@metamask/snaps-sdk/jsx';
import { Box, Copyable, Divider, Heading, Row, Text } from '@metamask/snaps-sdk/jsx';

import { capFractionDigits, formatAmount, type TokenMeta } from './token.js';

/**
 * The Snaps JSX automatic runtime does not ship a global `JSX` namespace, so we
 * bind `JSX.Element` to the SDK's own element type. This keeps the documented
 * `renderInsight(...): JSX.Element` signature while staying strictly typed
 * against the real Snaps element shape (`{ type, props, key }`).
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = GenericSnapElement;
  }
}

/** The exact sentence shown when there is no Klarity clear-signing to display. */
const NO_DATA = 'No Klarity clear-signing for this transaction.';

/**
 * Build the honest trust line text from the (optional) verified block.
 *
 * `null` / absent block and an unapproved EF gate both read "Not EF-attested".
 * Only `efApproved === true` reads "EF-attested". The public-vouch count is
 * always appended as a literal, neutral fact — vouches are ranking signal, not
 * a safety claim.
 */
function trustLine(verified: VerifiedBlock | null): string {
  const attested =
    verified !== null && verified.efApproved ? 'EF-attested' : 'Not EF-attested';
  const vouches = verified !== null ? verified.publicVouches : 0;
  return `${attested} - ${vouches} public vouches`;
}

/** A map from lowercased token address to its resolved metadata (or `null`). */
export type TokenMetaMap = Map<string, TokenMeta | null>;

/** True for an ABI integer type (`uint*`/`int*`), which may be a token amount. */
function isIntegerType(type: string | undefined): boolean {
  return type !== undefined && /^(?:u?int)\d*$/.test(type);
}

/** The 20-byte zero address — ERC-7730 uses it for the native asset, not ERC-20. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Matches a 0x-prefixed 20-byte address string. */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u;

/**
 * Decimals used to format an amount field whose ERC-20 token could not be
 * resolved to a concrete address (ERC-7730 native-asset amounts, or
 * `params.tokenPath` references the server left unresolved). 18 is the native
 * asset convention (ETH and every EVM native coin), so a raw wei integer like
 * `445806868670795` reads as `0.000445806868670795` instead of a wall of digits.
 */
const NATIVE_DECIMALS = 18;

/** True for an ERC-7730 amount field (`format: "tokenAmount"`). */
function isAmountField(field: SigningField): boolean {
  return field.format === 'tokenAmount';
}

/**
 * Longest a raw value is shown in full before it is truncated. Anything longer
 * is an address (42 chars) or a `bytes` blob (swap path descriptors, encoded
 * sub-calls, signatures) whose full text would flood the panel with an
 * unreadable wall of hex. 15 keeps a short selector or small integer intact
 * while trimming every address and long blob to the `3...3` form below.
 */
const MAX_INLINE_VALUE_LEN = 15;

/** Chars of a truncated value kept on each side of the ellipsis (`abc...xyz`). */
const TRUNC_KEEP = 3;

/**
 * Truncate a long string to `abc...xyz` form — {@link TRUNC_KEEP} chars at each
 * end around a literal `...`. Short strings (<= {@link MAX_INLINE_VALUE_LEN})
 * are returned unchanged.
 */
function truncateMiddle(value: string): string {
  if (value.length <= MAX_INLINE_VALUE_LEN) {
    return value;
  }
  return `${value.slice(0, TRUNC_KEEP)}...${value.slice(-TRUNC_KEEP)}`;
}

/**
 * True for a value that should be shown truncated with a copy button: any
 * address, or any value longer than {@link MAX_INLINE_VALUE_LEN} (long `bytes`
 * blobs — swap path descriptors, encoded sub-calls, signatures, raw permits).
 * A short scalar (a small integer, a selector, a bool) stays inline as-is.
 */
function isTruncatable(value: string): boolean {
  return ADDRESS_RE.test(value) || value.length > MAX_INLINE_VALUE_LEN;
}

/**
 * The token address for an amount field, if one is RELIABLY known. ERC-7730
 * `tokenAmount` carries it as a literal `params.token`; `params.tokenPath` is an
 * indirect reference the server does not resolve for us, so we do not guess it
 * (and address(0) means the native asset, not an ERC-20). Returns `null` when no
 * concrete ERC-20 address is available — caller then renders the plain integer.
 */
function tokenAddressOf(field: SigningField): string | null {
  const token = field.params?.token;
  if (
    typeof token === 'string' &&
    ADDRESS_RE.test(token) &&
    token.toLowerCase() !== ZERO_ADDRESS
  ) {
    return token;
  }
  return null;
}

/**
 * Render the inline value cell for one field. Honest by construction:
 *   - no decoded `value` -> `-` (not decoded; never a fabricated value);
 *   - an integer amount (`format: tokenAmount`) with a known ERC-20 token ->
 *     `formatAmount` + symbol (`1.0 USDC`), or `"<raw> (raw)"` if that token's
 *     metadata failed to resolve;
 *   - an integer amount with no resolvable token -> `formatAmount` at 18 decimals
 *     (the native-asset convention), so a raw wei integer reads as a human value;
 *   - an address or long `bytes` value -> the `abc...xyz` truncation (its row
 *     carries a `Copyable` with the full value — see `renderFieldRow`);
 *   - any other integer / short scalar -> the plain value as-is.
 */
function renderValueText(
  field: SigningField,
  tokenMeta: TokenMetaMap,
): JSX.Element {
  if (field.value === undefined) {
    return <Text color="muted">-</Text>;
  }

  if (isIntegerType(field.type)) {
    const tokenAddress = tokenAddressOf(field);
    if (tokenAddress !== null) {
      const meta = tokenMeta.get(tokenAddress.toLowerCase());
      if (meta === null || meta === undefined) {
        // Resolve failed (or was not attempted): show raw units, marked honest.
        return <Text>{`${field.value} (raw)`}</Text>;
      }
      const formatted = capFractionDigits(formatAmount(field.value, meta.decimals));
      const withSymbol = meta.symbol ? `${formatted} ${meta.symbol}` : formatted;
      return <Text>{withSymbol}</Text>;
    }
    // An amount with no resolvable ERC-20 token (native asset, or an unresolved
    // tokenPath): format at the native 18-decimal convention. A plain non-amount
    // integer (a nonce, a deadline) is left as its literal base-10 value.
    if (isAmountField(field)) {
      return <Text>{capFractionDigits(formatAmount(field.value, NATIVE_DECIMALS))}</Text>;
    }
  }

  // An address or a long raw value (a `bytes` blob) is shown truncated to the
  // `abc...xyz` form. The full value is NOT lost: the field's row renders a
  // `Copyable` beneath this text (see `renderFieldRow`) so one tap copies it.
  if (isTruncatable(field.value)) {
    return <Text>{truncateMiddle(field.value)}</Text>;
  }

  return <Text>{field.value}</Text>;
}

/**
 * Render one decoded field as a labeled row. A short scalar is a single `Row`
 * (label + inline value). An address or long `bytes` value is a `Row` showing
 * the `abc...xyz` truncation, followed by a `Copyable` at Box level carrying the
 * FULL value — the copy button every address and blob gets. (`Copyable` is a
 * block element, so it is a sibling of the `Row`, never nested inside it, which
 * the Snaps renderer forbids.)
 */
function renderFieldRow(
  field: SigningField,
  tokenMeta: TokenMetaMap,
  variant?: 'default',
): JSX.Element {
  const copyable =
    field.value !== undefined && isTruncatable(field.value) ? (
      <Copyable value={field.value} />
    ) : null;
  return (
    <Box key={field.path}>
      <Row label={field.label} variant={variant}>
        {renderValueText(field, tokenMeta)}
      </Row>
      {copyable}
    </Box>
  );
}

/**
 * Render a decoded inner call (1inch `permitAndCall` `action`) as a nested
 * `Box` at Box level — never inside a `Row` (Snaps JSX forbids block children in
 * a Row). An unresolved inner call is shown honestly as "Unknown inner call"
 * with the raw selector; a resolved one shows its summary heading and fields.
 */
function renderInner(inner: DecodeResponse, tokenMeta: TokenMetaMap): JSX.Element {
  if (inner.unresolved === true) {
    const selector = (inner.raw.calldata ?? '').slice(0, 10);
    return (
      <Box>
        <Text color="muted">Unknown inner call</Text>
        <Row label="Selector">
          <Text>{selector}</Text>
        </Row>
      </Box>
    );
  }

  const summary =
    inner.functionSignature ??
    inner.signing.functionSignature ??
    inner.signing.summary ??
    'Inner call';

  return (
    <Box>
      <Text color="muted">Inner call</Text>
      <Heading>{summary}</Heading>
      {inner.fields.map((field) => renderFieldRow(field, tokenMeta))}
    </Box>
  );
}

/**
 * Render a decoded permit payload (1inch `permitAndCall` `permit`) as a titled
 * `Box` block, each permit field as a `Row`. An unrecognized permit is titled
 * honestly and reports only the raw byte length, never a fabricated field.
 */
function renderPermit(permit: SigningField['permit']): JSX.Element | null {
  if (permit === undefined) {
    return null;
  }
  if (permit.format === 'unknown') {
    const rawLen = permit.raw ? Math.max((permit.raw.length - 2) / 2, 0) : 0;
    return (
      <Box>
        <Text color="muted">Permit (unrecognized)</Text>
        <Text color="muted">{`raw permit: ${rawLen} bytes`}</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text color="muted">Permit</Text>
      {permit.fields.map((pf, i) => (
        <Box key={`permit-${i}`}>
          <Row label={pf.label}>
            <Text>{isTruncatable(pf.value) ? truncateMiddle(pf.value) : pf.value}</Text>
          </Row>
          {isTruncatable(pf.value) ? <Copyable value={pf.value} /> : null}
        </Box>
      ))}
    </Box>
  );
}

/**
 * Render the clear-signing insight panel.
 *
 * @param decode - The decoded signing summary, or `null` when Klarity has no
 * clear-signing for this transaction.
 * @param verified - The two-tier verified block, or `null` when absent.
 * @param interactionContext - The chain/contract/selector the vouch is keyed to.
 * Retained for call-site compatibility; the panel no longer embeds a capture
 * form, so this is currently unused by the render.
 * @param decodeError - When `decode` is `null` because the decode REQUEST FAILED
 * (unreachable API, sandbox-blocked host, 5xx) rather than a genuine 404, the
 * error message to surface beneath the no-data line. A genuine "no descriptor"
 * leaves this `null`/undefined so the panel stays the plain honest no-data view.
 * @param tokenMeta - A pre-resolved map (lowercased token address -> metadata or
 * `null`) the caller fills via `resolveToken` BEFORE calling. Keeping it an input
 * leaves `renderInsight` PURE and synchronous (testable with no live provider);
 * `onTransaction` awaits the resolves and hands the finished map in here.
 * @returns The JSX element for the Snaps insight panel.
 */
export function renderInsight(
  decode: DecodeResponse | null,
  verified: VerifiedBlock | null,
  interactionContext?: { chainId: number; contract: string; selector: string },
  decodeError?: string | null,
  tokenMeta: TokenMetaMap = new Map(),
): JSX.Element {
  if (decode === null) {
    // A reachable API that simply has no descriptor (HTTP 404) is the honest
    // "nothing to clear-sign" case. A transport error (the API was not
    // reachable, the snap sandbox blocked the host, a 5xx, ...) is DIFFERENT:
    // we must not claim there is nothing to sign when we never got an answer.
    if (decodeError !== undefined && decodeError !== null) {
      return (
        <Box>
          <Text>{NO_DATA}</Text>
          <Text color="muted">decode error: {decodeError}</Text>
        </Box>
      );
    }
    return (
      <Box>
        <Text>{NO_DATA}</Text>
      </Box>
    );
  }

  const { signing, fields, hiddenFields, note } = decode;
  const headline =
    signing.interpolatedIntent ?? signing.intent ?? signing.summary;

  return (
    <Box>
      <Heading>{headline}</Heading>

      {fields.map((field) => (
        <Box key={field.path}>
          {renderFieldRow(field, tokenMeta)}
          {field.permit ? renderPermit(field.permit) : null}
          {field.inner ? renderInner(field.inner, tokenMeta) : null}
        </Box>
      ))}

      {hiddenFields.length > 0 ? (
        <Box>
          <Text color="muted">Hidden fields</Text>
          {hiddenFields.map((field) => renderFieldRow(field, tokenMeta, 'default'))}
        </Box>
      ) : null}

      <Divider />
      <Text>{note}</Text>

      <Divider />
      <Text>{trustLine(verified)}</Text>
    </Box>
  );
}
