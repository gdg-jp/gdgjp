import { nowSeconds } from "../../lib";

/**
 * Where the reply goes: edit the deferred Discord response, edit the bot's placeholder reply to
 * an @mention (messages arrive from the Gateway listener on the OCI VM), or post into a Chat
 * thread.
 */
export type Delivery =
  | { platform: "discord"; applicationId: string; interactionToken: string; ephemeral: boolean }
  | { platform: "discord-message"; channelId: string; messageId: string }
  | { platform: "google-chat"; space: string; thread: string | null };

export type DegradedHit = { title: string; url: string; snippet: string };

export type PendingAnswer = {
  jobId: string;
  delivery: Delivery;
  question: string;
  /** Top search hits, for the degraded reply when the runner does not answer. */
  hits: DegradedHit[];
  spaces: string[];
  excludedSpaces: string[];
  /** Matching pages hidden from this reader by the wiki's ACL. */
  excludedPages?: number;
  /** Public replies offer "answer with my permissions". */
  publicReply: boolean;
  platform: "discord" | "google-chat";
  chatUserId: string;
  venue: string;
  readerKind: "user" | "principal" | "anonymous";
  createdAt: number;
  deadlineAt: number;
  status: "pending" | "answered" | "degraded";
};

export type PendingStore = {
  insert(row: PendingAnswer): Promise<void>;
  get(jobId: string): Promise<PendingAnswer | null>;
  /** pending → answered/degraded exactly once; false when someone else got there first. */
  settle(jobId: string, status: "answered" | "degraded"): Promise<boolean>;
  overdue(now: number): Promise<PendingAnswer[]>;
  countPending(): Promise<number>;
};

export function d1PendingStore(db: D1Database): PendingStore {
  return {
    async insert(row) {
      await db
        .prepare(
          "INSERT INTO pending_answers (job_id, payload, status, deadline_at, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(row.jobId, JSON.stringify(row), row.status, row.deadlineAt, row.createdAt)
        .run();
    },
    async get(jobId) {
      const row = await db
        .prepare("SELECT payload, status FROM pending_answers WHERE job_id = ?")
        .bind(jobId)
        .first<{ payload: string; status: PendingAnswer["status"] }>();
      return row ? { ...(JSON.parse(row.payload) as PendingAnswer), status: row.status } : null;
    },
    async settle(jobId, status) {
      const result = await db
        .prepare(
          "UPDATE pending_answers SET status = ?, settled_at = ? WHERE job_id = ? AND status = 'pending'",
        )
        .bind(status, nowSeconds(), jobId)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },
    async overdue(now) {
      const { results } = await db
        .prepare(
          "SELECT payload FROM pending_answers WHERE status = 'pending' AND deadline_at < ? LIMIT 50",
        )
        .bind(now)
        .all<{ payload: string }>();
      return results.map((row) => ({
        ...(JSON.parse(row.payload) as PendingAnswer),
        status: "pending" as const,
      }));
    },
    async countPending() {
      const row = await db
        .prepare("SELECT COUNT(*) AS n FROM pending_answers WHERE status = 'pending'")
        .first<{ n: number }>();
      return row?.n ?? 0;
    },
  };
}

export function memoryPendingStore(): PendingStore & { rows: Map<string, PendingAnswer> } {
  const rows = new Map<string, PendingAnswer>();
  return {
    rows,
    async insert(row) {
      rows.set(row.jobId, { ...row });
    },
    async get(jobId) {
      return rows.get(jobId) ?? null;
    },
    async settle(jobId, status) {
      const row = rows.get(jobId);
      if (!row || row.status !== "pending") return false;
      row.status = status;
      return true;
    },
    async overdue(now) {
      return [...rows.values()].filter((row) => row.status === "pending" && row.deadlineAt < now);
    },
    async countPending() {
      return [...rows.values()].filter((row) => row.status === "pending").length;
    },
  };
}
