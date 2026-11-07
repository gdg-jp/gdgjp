/** One thread per campaign: what people say to the assistant, and what it says back or on its own. */

export type Attachment = { id: string; name: string; type: string; size: number };

export const ACTION_TYPES = [
  "run_plan",
  "adopt_plan",
  "draft_items",
  "move_item",
  "open_page",
  "revert_brief",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type ActionStatus = "proposed" | "done" | "failed" | "dismissed";

/** A button under a message. The Worker validates every field before it is shown or run. */
export type MessageAction = {
  type: ActionType;
  label: string;
  scheduleItemIds?: number[];
  dueAt?: string | null;
  path?: string | null;
  instructions?: string | null;
  planVersion?: number;
  briefVersion?: number;
  status: ActionStatus;
  result?: string;
};

export type MessageMeta = {
  briefVersion?: number;
  briefChanges?: string[];
  errors?: string[];
};

export type Message = {
  id: number;
  campaignId: number;
  author: "user" | "assistant";
  userId: string | null;
  userName: string | null;
  body: string;
  attachments: Attachment[];
  actions: MessageAction[];
  questions: string[];
  meta: MessageMeta;
  jobId: string | null;
  eventKey: string | null;
  createdAt: number;
};

/** Open questions: the assistant asked, and nobody has written since. */
export function openQuestions(
  messages: Message[],
): { messageId: number; questions: string[] } | null {
  const last = messages[messages.length - 1];
  if (!last || last.author !== "assistant" || last.questions.length === 0) return null;
  return { messageId: last.id, questions: last.questions };
}

/** URLs in what a person wrote, in order, without duplicates or trailing punctuation. */
export function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'「」（）()、。]+/g)) {
    const url = match[0].replace(/[.,;:!?）)\]]+$/, "");
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

export const MAX_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
];
