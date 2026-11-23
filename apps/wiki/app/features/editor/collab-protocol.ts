import { diffChars } from "diff";
import * as Y from "yjs";

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;

export function applyStringToYText(ytext: Y.Text, newValue: string): void {
  const currentValue = ytext.toString();
  if (currentValue === newValue) return;

  const changes = diffChars(currentValue, newValue);
  ytext.doc?.transact(() => {
    let pos = 0;
    for (const change of changes) {
      if (change.removed) {
        ytext.delete(pos, change.value.length);
      } else if (change.added) {
        ytext.insert(pos, change.value);
        pos += change.value.length;
      } else {
        pos += change.value.length;
      }
    }
  });
}

export function encodeRelativeCursor(ytext: Y.Text, pos: number): unknown {
  const clamped = Math.max(0, Math.min(pos, ytext.length));
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, clamped));
}

export function decodeRelativeCursor(cursor: unknown, ydoc: Y.Doc): number | null {
  if (!cursor || typeof cursor !== "object") return null;
  try {
    const relPos = Y.createRelativePositionFromJSON(cursor);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);
    return absPos ? absPos.index : null;
  } catch {
    return null;
  }
}
