/**
 * Shared types and pure helpers for OST topics.
 *
 * The Durable Object (`workers/ost-board.ts`) and the routes both import from
 * here so validation lives in exactly one place and can be unit-tested in node.
 */

export const MAX_TOPIC_LENGTH = 200;

export type Topic = {
  id: string;
  text: string;
  createdAt: number;
};

/** Messages the board Durable Object pushes to connected admin screens. */
export type BoardMessage =
  | { type: "snapshot"; topics: Topic[] }
  | { type: "added"; topic: Topic }
  | { type: "deleted"; id: string }
  | { type: "cleared" };

/**
 * Normalize a raw form value into a storable topic string.
 *
 * Returns `null` when the input is not a usable topic (not a string, empty
 * after trimming, or longer than {@link MAX_TOPIC_LENGTH} once whitespace is
 * collapsed).
 */
export function normalizeTopicText(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0 || collapsed.length > MAX_TOPIC_LENGTH) {
    return null;
  }
  return collapsed;
}
