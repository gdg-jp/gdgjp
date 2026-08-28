/**
 * Shared types and pure helpers for OST boards.
 *
 * The Durable Object (`workers/ost-board.ts`) and the routes both import from
 * here so validation and the wire format live in exactly one place and can be
 * unit-tested in node.
 */

export const MAX_TOPIC_LENGTH = 200;

export type Topic = {
  id: string;
  text: string;
  createdAt: number;
  /** Merge group this topic belongs to, or null when standalone. */
  groupId: string | null;
  /** Desk this topic is assigned to, or null when unassigned. */
  deskId: string | null;
};

export type Group = {
  id: string;
  label: string | null;
  createdAt: number;
};

export type Desk = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  sortOrder: number;
  createdAt: number;
};

/** Full board state. Broadcast on every mutation; also the loader seed shape. */
export type OstBoardState = {
  topics: Topic[];
  groups: Group[];
  desks: Desk[];
  /** topicId -> number of 👍 votes. Counts only; never per-voter rows. */
  voteCounts: Record<string, number>;
};

/** The single message the board Durable Object pushes to connected clients. */
export type BoardMessage = { type: "state"; state: OstBoardState };

export function emptyBoardState(): OstBoardState {
  return { topics: [], groups: [], desks: [], voteCounts: {} };
}

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
