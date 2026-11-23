export const MAX_TOPIC_LENGTH = 200;

export type Topic = {
  id: string;
  text: string;
  createdAt: number;
  groupId: string | null;
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
  rotation: number;
  sortOrder: number;
  createdAt: number;
};

export type DeskInput = {
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  label?: string;
};
export type DeskPatch = Partial<Pick<Desk, "x" | "y" | "width" | "height" | "rotation" | "label">>;

export type OstBoardState = {
  topics: Topic[];
  groups: Group[];
  desks: Desk[];
  voteCounts: Record<string, number>;
};

export type BoardMessage = { type: "state"; state: OstBoardState };

export function emptyBoardState(): OstBoardState {
  return { topics: [], groups: [], desks: [], voteCounts: {} };
}

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
