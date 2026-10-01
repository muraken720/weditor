import type { Snapshot } from "./types.ts";
import {
  MAX_HISTORY_BYTES,
  MAX_TOTAL_HISTORY_BYTES,
  MAX_HISTORY_ENTRIES,
} from "./limits.ts";
export interface History {
  undo: Snapshot[];
  redo: Snapshot[];
}
const bytes = (stack: readonly Snapshot[]) =>
  stack.reduce((sum, state) => sum + state.text.length * 2, 0);
const totalBytes = (history: History) =>
  bytes(history.undo) + bytes(history.redo);
function discardOldest(history: History) {
  const stack =
    bytes(history.undo) >= bytes(history.redo) ? history.undo : history.redo;
  // At equal byte counts an empty undo stack can still have nonempty redo entries.
  (stack.length ? stack : history.redo).shift();
}
export function limitHistories(histories: readonly History[]) {
  for (const history of histories) {
    while (
      history.undo.length + history.redo.length > 1 &&
      (history.undo.length + history.redo.length > MAX_HISTORY_ENTRIES ||
        totalBytes(history) > MAX_HISTORY_BYTES)
    )
      discardOldest(history);
  }
  let sum = histories.reduce((sum, history) => sum + totalBytes(history), 0);
  while (sum > MAX_TOTAL_HISTORY_BYTES) {
    const largest = histories.reduce((largest, history) =>
      totalBytes(history) > totalBytes(largest) ? history : largest,
    );
    const before = totalBytes(largest);
    discardOldest(largest);
    sum -= before - totalBytes(largest);
  }
}
export function rememberEdit(
  histories: readonly History[],
  history: History,
  state: Snapshot,
) {
  if (history.undo.at(-1)?.text !== state.text) history.undo.push(state);
  history.redo = [];
  limitHistories(histories);
}
export function moveHistory(
  histories: readonly History[],
  history: History,
  current: Snapshot,
  redo: boolean,
): Snapshot | null {
  const from = redo ? history.redo : history.undo;
  const to = redo ? history.undo : history.redo;
  const state = from.pop();
  if (!state) return null;
  to.push(current);
  limitHistories(histories);
  return state;
}
