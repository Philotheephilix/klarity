/**
 * Home-page dashboard renderer.
 *
 * Renders the view shown when the user opens the Snap's home page in MetaMask.
 * It lists the user's captured vouches split into two honest sections:
 *   - PENDING: captured but not yet submitted on-chain (`attemptedUid` unset).
 *   - SUBMITTED: already attested, shown with the attestation UID it produced.
 *
 * Like the insight panel, this view is deliberately LABELS-ONLY and contains no
 * emoji: it shows the contract, a plain rating, and the UID — never a safety
 * claim. An empty store renders a single honest "No pending vouches" line and
 * never throws.
 */
import type { GenericSnapElement, JSXElement } from '@metamask/snaps-sdk/jsx';
import { Box, Divider, Heading, Row, Text } from '@metamask/snaps-sdk/jsx';

import type { PendingVouch } from './pending.js';

/**
 * Narrow the home-page tree to the SDK's `JSXElement` content type.
 *
 * The Snaps JSX automatic runtime types every `<Box>`/`<Row>`/... as the
 * structurally-wider `GenericSnapElement`, while `OnHomePageHandler` requires
 * the discriminated `JSXElement` union. The runtime value is always a real
 * element tree, so this is a pure boundary narrowing with no behavioural effect
 * (mirrors `asInsightContent` in index.ts).
 */
function asHomeContent(element: GenericSnapElement): JSXElement {
  return element as unknown as JSXElement;
}

/**
 * Render the home-page vouch dashboard.
 *
 * @param pending - All stored vouches (pending and submitted). An empty array
 * renders the honest empty state.
 * @returns The JSX element for the Snaps home page.
 */
export function renderHome(pending: PendingVouch[]): JSXElement {
  const pendingOnly = pending.filter((v) => v.attemptedUid === undefined);
  const submitted = pending.filter((v) => v.attemptedUid !== undefined);

  if (pendingOnly.length === 0 && submitted.length === 0) {
    return asHomeContent(
      <Box>
        <Heading>Klarity vouches</Heading>
        <Text>No pending vouches</Text>
      </Box>,
    );
  }

  return asHomeContent(
    <Box>
      <Heading>Klarity vouches</Heading>

      <Text>Pending</Text>
      {pendingOnly.length === 0 ? (
        <Text>No pending vouches</Text>
      ) : (
        <Box>
          {pendingOnly.map((v) => (
            <Row label={v.contract} key={v.interactionTxHash}>
              <Text>Rated {String(v.rating)}/5</Text>
            </Row>
          ))}
        </Box>
      )}

      {submitted.length > 0 ? (
        <Box>
          <Divider />
          <Text>Submitted</Text>
          {submitted.map((v) => (
            <Row label={v.contract} key={v.interactionTxHash}>
              <Text>{v.attemptedUid as string}</Text>
            </Row>
          ))}
        </Box>
      ) : null}
    </Box>,
  );
}
