import type { OnTransactionHandler } from '@metamask/snaps-sdk';
import { panel, heading, text } from '@metamask/snaps-sdk';

/**
 * Transaction insight handler.
 *
 * Placeholder implementation: returns a minimal static panel. A later task
 * wires the real clear-signing lookup against the Klarity registry and the
 * descriptor hashing provided by the Klarity SDK.
 */
export const onTransaction: OnTransactionHandler = async () => {
  return {
    content: panel([
      heading('Klarity clear-signing'),
      text('Clear-signing insights will appear here.'),
    ]),
  };
};
