/**
 * Pre-sign vouch capture form.
 *
 * Renders the interactive capture surface shown inside the clear-signing insight
 * panel: a 1..5 rating `RadioGroup`, a free-text comment `Input`, and a submit
 * `Button`. The user's answer is captured BEFORE they sign; it is stored PENDING
 * and only submitted on-chain once the transaction is mined.
 *
 * Like render.tsx and prompt.tsx, this surface is deliberately HONEST and
 * LABELS-ONLY: it shows no decoded on-chain argument values, makes no safety
 * claim, and contains no emoji. It is a pure capture form.
 *
 * The Snap is a CLIENT of the Klarity server; this module captures an answer, it
 * never decides trust.
 */
import type { GenericSnapElement } from '@metamask/snaps-sdk/jsx';
import {
  Box,
  Button,
  Field,
  Form,
  Input,
  Radio,
  RadioGroup,
  Text,
} from '@metamask/snaps-sdk/jsx';

/**
 * Precise per-component element types, derived from the imported component
 * factories. The strictly-typed `Field`/`RadioGroup` children slots demand these
 * exact element shapes (e.g. `SnapElement<RadioProps, 'Radio'>`), but render.tsx
 * binds the global `JSX.Element` to the looser `GenericSnapElement`, so a bare
 * `<Radio>`/`<Input>`/`<RadioGroup>` child widens to `GenericSnapElement` and no
 * longer typechecks against those slots. Asserting each strict child back to its
 * factory's `ReturnType` is a fully typed narrowing (no `any`, no suppression)
 * that does not change the rendered output.
 */
type RadioEl = ReturnType<typeof Radio>;
type InputEl = ReturnType<typeof Input>;
type RadioGroupEl = ReturnType<typeof RadioGroup>;

/** The uint8 floor a rating must meet (EAS `uint8` is `[0,255]`; 0 is not a vouch). */
const RATING_MIN = 1;

/** The uint8 ceiling a rating may reach. */
const RATING_MAX = 255;

/**
 * The maximum comment length stored on-chain. Comments longer than this are
 * truncated at capture time so they never reach the EAS `string comment`
 * encoder as an unbounded blob. 280 chars is a deliberate, documented cap.
 */
export const COMMENT_MAX = 280;

/** The exact label on the submit button; the em-dash is punctuation, not emoji. */
const SUBMIT_LABEL = 'Looks good — vouch when mined';

/**
 * Build the pre-sign vouch capture form.
 *
 * @param args - Context for the capture surface.
 * @param args.contract - The contract address the interaction touches (label only).
 * @param args.interactionContext - The chain/contract/selector the vouch is keyed
 * to; carried for the caller's wiring, not rendered as decoded values.
 * @returns The JSX `Form` element embedded in the insight panel.
 */
export function renderVouchForm(args: {
  contract: string;
  interactionContext: { chainId: number; contract: string; selector: string };
}): GenericSnapElement {
  return (
    <Box>
      <Form name="klarity-vouch">
        <Text>
          Only vouch if you verified yourself that this transaction did what the
          clear-signing described. Your vouch is stored and submitted when the
          transaction is mined.
        </Text>
        <Field label="Rating">
          {(
            <RadioGroup name="rating">
              {(<Radio value="1">1</Radio>) as unknown as RadioEl}
              {(<Radio value="2">2</Radio>) as unknown as RadioEl}
              {(<Radio value="3">3</Radio>) as unknown as RadioEl}
              {(<Radio value="4">4</Radio>) as unknown as RadioEl}
              {(<Radio value="5">5</Radio>) as unknown as RadioEl}
            </RadioGroup>
          ) as unknown as RadioGroupEl}
        </Field>
        <Field label="Comment">
          {(<Input name="comment" type="text" />) as unknown as InputEl}
        </Field>
        <Button name="submit" type="submit">
          {SUBMIT_LABEL}
        </Button>
      </Form>
    </Box>
  );
}

/**
 * Validate and normalize raw form state into a submittable vouch.
 *
 * The rating must parse to an INTEGER in `[RATING_MIN, RATING_MAX]` (the on-chain
 * `uint8` range, floored at 1 since 0 is not a vouch); anything non-integer, out
 * of range, or unparseable returns an `{ error }` describing the problem. The
 * comment is coerced to a string and truncated to `COMMENT_MAX`.
 *
 * @param state - The raw interface state (`rating`/`comment` as optional strings).
 * @returns `{ rating, comment }` on success, or `{ error }` on invalid input.
 */
export function parseVouchInput(state: {
  rating?: string;
  comment?: string;
}): { rating: number; comment: string } | { error: string } {
  const raw = state.rating;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { error: 'Select a rating from 1 to 5 before vouching.' };
  }

  const rating = Number(String(raw).trim());
  if (!Number.isInteger(rating)) {
    return { error: `Rating must be a whole number, got "${String(raw)}".` };
  }
  if (rating < RATING_MIN || rating > RATING_MAX) {
    return {
      error: `Rating must be between ${RATING_MIN} and ${RATING_MAX}.`,
    };
  }

  const comment = String(state.comment ?? '').slice(0, COMMENT_MAX);
  return { rating, comment };
}
