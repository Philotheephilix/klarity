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
import type { DecodeResponse, VerifiedBlock } from '@klarity/sdk';
import type { GenericSnapElement } from '@metamask/snaps-sdk/jsx';
import { Box, Divider, Heading, Row, Text } from '@metamask/snaps-sdk/jsx';

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

/**
 * Render the clear-signing insight panel.
 *
 * @param decode - The decoded signing summary, or `null` when Klarity has no
 * clear-signing for this transaction.
 * @param verified - The two-tier verified block, or `null` when absent.
 * @returns The JSX element for the Snaps insight panel.
 */
export function renderInsight(
  decode: DecodeResponse | null,
  verified: VerifiedBlock | null,
): JSX.Element {
  if (decode === null) {
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
        <Row label={field.label} key={field.path}>
          <Text color="muted">-</Text>
        </Row>
      ))}

      {hiddenFields.length > 0 ? (
        <Box>
          <Text color="muted">Hidden fields</Text>
          {hiddenFields.map((field) => (
            <Row label={field.label} variant="default" key={field.path}>
              <Text color="muted">hidden</Text>
            </Row>
          ))}
        </Box>
      ) : null}

      <Divider />
      <Text>{note}</Text>

      <Divider />
      <Text>{trustLine(verified)}</Text>
    </Box>
  );
}
