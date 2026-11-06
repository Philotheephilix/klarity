/**
 * Ranking-vouch confirmation prompt.
 *
 * Content for the `snap_dialog` confirmation shown before a user submits a
 * public-tier vouch. It asks the one question that defines the vouch: did the
 * mined transaction do what the clear-signing described? It shows only the
 * contract and transaction LABELS for context — no decoded values, no secrets,
 * no emoji — mirroring render.tsx's labels-only honesty.
 *
 * The Snap is a CLIENT of the Klarity server; this module renders a question,
 * it never decides trust.
 */
import type { GenericSnapElement } from '@metamask/snaps-sdk/jsx';
import { Box, Heading, Row, Text } from '@metamask/snaps-sdk/jsx';

/** The question that defines a ranking vouch. */
const QUESTION = 'Did this transaction do what the clear-signing described?';

/**
 * Build the vouch-confirmation panel.
 *
 * @param args - Context labels for the confirmation.
 * @param args.contract - The contract address the interaction touched.
 * @param args.interactionTxHash - The mined transaction hash being vouched for.
 * @returns The JSX content for the `snap_dialog` confirmation.
 */
export function renderRankPrompt(args: {
  contract: string;
  interactionTxHash: string;
}): GenericSnapElement {
  return (
    <Box>
      <Heading>{QUESTION}</Heading>
      <Text>
        Vouching tells other users this contract behaved as its clear-signing
        said. Only vouch if you verified the outcome yourself.
      </Text>
      <Row label="Contract">
        <Text>{args.contract}</Text>
      </Row>
      <Row label="Transaction">
        <Text>{args.interactionTxHash}</Text>
      </Row>
    </Box>
  );
}
