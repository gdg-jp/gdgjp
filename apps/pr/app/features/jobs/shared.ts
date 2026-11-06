export const JOB_TYPES = [
  "plan",
  "copy",
  "post",
  "page",
  "asset",
  "analyze",
  "review",
  "retro",
  "fix",
] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type JobStatus = "queued" | "leased" | "succeeded" | "failed" | "needs_review" | "expired";

/** Higher runs first. Fixes jump the queue so a draft is not left half-done. */
export const JOB_PRIORITY: Record<JobType, number> = {
  review: 10,
  fix: 8,
  copy: 5,
  post: 5,
  page: 5,
  asset: 4,
  plan: 0,
  analyze: -5,
  retro: -10,
};

/** Seconds the runner may spend on one job before its bundle says to stop. */
export const JOB_TIMEOUT_SECONDS: Record<JobType, number> = {
  plan: 900,
  copy: 480,
  post: 480,
  page: 600,
  asset: 480,
  analyze: 900,
  review: 300,
  retro: 1200,
  fix: 480,
};

export const LEASE_SECONDS = 20 * 60;
export const MAX_ATTEMPTS = 3;

export type FixTarget =
  | { table: "plans"; id: number; version: number }
  | { table: "drafts"; id: number; version: number };

export type JobPayload =
  | { type: "plan"; briefVersion: number; instructions?: string }
  | {
      type: "copy";
      briefVersion: number;
      planVersion?: number | null;
      count: number;
      draftId?: number | null;
      instructions?: string;
    }
  | {
      type: "post";
      briefVersion: number;
      scheduleItemIds: number[];
      channel: "x" | "ig";
      copyDraftId?: number | null;
      instructions?: string;
    }
  | { type: "fix"; target: FixTarget; kind: string; failures: { ruleId: string; detail: string }[] }
  | { type: Exclude<JobType, "plan" | "copy" | "post" | "fix">; [key: string]: unknown };

export type Job = {
  id: string;
  type: JobType;
  campaignId: number;
  status: JobStatus;
  priority: number;
  payload: JobPayload;
  result: unknown;
  error: string | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  attempts: number;
  runAfter: number;
  requestedBy: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

/** What the runner posts back (the wiki runner's Result shape; extra fields are ignored). */
export type RunnerResult = {
  status: "succeeded" | "failed" | "needs_review";
  result?: {
    output?: unknown;
    checks?: { yomiyasu?: { status: "pass" | "fail" | "unevaluated"; detail?: string } };
  } | null;
  error?: string;
  retry?: boolean;
};

/** ULID-ish: time-sortable and unique enough for job ids. */
export function newJobId(now = Date.now()): string {
  const time = now.toString(36).padStart(9, "0");
  const random = crypto.getRandomValues(new Uint8Array(8));
  return `job_${time}${[...random]
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12)}`;
}
