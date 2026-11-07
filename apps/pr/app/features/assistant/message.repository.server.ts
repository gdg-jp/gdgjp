import type { Attachment, Message, MessageAction, MessageMeta } from "./message";

type Row = {
  id: number;
  campaign_id: number;
  author: "user" | "assistant";
  user_id: string | null;
  user_name: string | null;
  body: string;
  attachments: string;
  actions: string;
  questions: string;
  meta: string;
  job_id: string | null;
  event_key: string | null;
  created_at: number;
};

function parse<T>(raw: string, fallback: T): T {
  try {
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function toMessage(row: Row): Message {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    author: row.author,
    userId: row.user_id,
    userName: row.user_name,
    body: row.body,
    attachments: parse<Attachment[]>(row.attachments, []),
    actions: parse<MessageAction[]>(row.actions, []),
    questions: parse<string[]>(row.questions, []),
    meta: parse<MessageMeta>(row.meta, {}),
    jobId: row.job_id,
    eventKey: row.event_key,
    createdAt: row.created_at,
  };
}

export type NewMessage = {
  campaignId: number;
  author: "user" | "assistant";
  userId?: string | null;
  userName?: string | null;
  body: string;
  attachments?: Attachment[];
  actions?: MessageAction[];
  questions?: string[];
  meta?: MessageMeta;
  jobId?: string | null;
  /** Posted once per campaign and key; a repeat returns null. */
  eventKey?: string | null;
};

export async function insertMessage(db: D1Database, input: NewMessage): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO campaign_messages
         (campaign_id, author, user_id, user_name, body, attachments, actions, questions, meta, job_id, event_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING id`,
    )
    .bind(
      input.campaignId,
      input.author,
      input.userId ?? null,
      input.userName ?? null,
      input.body,
      JSON.stringify(input.attachments ?? []),
      JSON.stringify(input.actions ?? []),
      JSON.stringify(input.questions ?? []),
      JSON.stringify(input.meta ?? {}),
      input.jobId ?? null,
      input.eventKey ?? null,
    )
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** The newest `limit` messages, oldest first. */
export async function listMessages(
  db: D1Database,
  campaignId: number,
  limit = 100,
): Promise<Message[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM (SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id",
    )
    .bind(campaignId, limit)
    .all<Row>();
  return results.map(toMessage);
}

export async function getMessage(
  db: D1Database,
  campaignId: number,
  id: number,
): Promise<Message | null> {
  const row = await db
    .prepare("SELECT * FROM campaign_messages WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .first<Row>();
  return row ? toMessage(row) : null;
}

/** The last message of each campaign (for the notifications page). */
export async function lastMessages(
  db: D1Database,
  campaignIds: number[],
): Promise<Map<number, Message>> {
  const out = new Map<number, Message>();
  // D1 binds at most 100 variables per statement.
  for (let i = 0; i < campaignIds.length; i += 80) {
    const chunk = campaignIds.slice(i, i + 80);
    const { results } = await db
      .prepare(
        `SELECT m.* FROM campaign_messages m
         JOIN (SELECT campaign_id, MAX(id) AS id FROM campaign_messages
               WHERE campaign_id IN (${chunk.map(() => "?").join(",")}) GROUP BY campaign_id) l
           ON l.id = m.id`,
      )
      .bind(...chunk)
      .all<Row>();
    for (const r of results) out.set(r.campaign_id, toMessage(r));
  }
  return out;
}

export async function setActions(
  db: D1Database,
  campaignId: number,
  id: number,
  actions: MessageAction[],
): Promise<void> {
  await db
    .prepare("UPDATE campaign_messages SET actions = ? WHERE campaign_id = ? AND id = ?")
    .bind(JSON.stringify(actions), campaignId, id)
    .run();
}
