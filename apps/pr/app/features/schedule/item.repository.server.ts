import type { Brief } from "~/features/briefs/brief";
import { constants } from "~/features/playbook/playbook";
import { deriveItems } from "./derive";
import type { ItemInput, ScheduleItem } from "./item";
import type { ItemStatus } from "./kinds";
import { isScheduleKind } from "./kinds";

export type ItemRow = {
  id: number;
  campaign_id: number;
  kind: string;
  channel: string | null;
  due_at: number;
  title: string;
  note: string | null;
  draft_id: number | null;
  assignee_user_id: string | null;
  reviewer_user_id: string | null;
  requires_approval: number;
  status: ItemStatus;
  blocked_by: string;
  request_status: ScheduleItem["requestStatus"];
  request_followup_at: number | null;
  external_ref: string | null;
  derived_from_item_id: number | null;
  offset_minutes: number | null;
  speaker_id: string | null;
  session_id: string | null;
  purpose: string | null;
  variant: string | null;
  plan_version: number | null;
  created_at: number;
  updated_at: number;
};

const json = <T>(raw: string | null, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function toItem(row: ItemRow): ScheduleItem {
  if (!isScheduleKind(row.kind)) throw new Error(`unknown schedule kind ${row.kind}`);
  return {
    id: row.id,
    campaignId: row.campaign_id,
    kind: row.kind,
    channel: row.channel,
    dueAt: row.due_at,
    title: row.title,
    note: row.note,
    draftId: row.draft_id,
    assigneeUserId: row.assignee_user_id,
    reviewerUserId: row.reviewer_user_id,
    requiresApproval: row.requires_approval === 1,
    status: row.status,
    blockedBy: json<string[]>(row.blocked_by, []),
    requestStatus: row.request_status,
    requestFollowupAt: row.request_followup_at,
    externalRef: json<Record<string, unknown> | null>(row.external_ref, null),
    derivedFromItemId: row.derived_from_item_id,
    offsetMinutes: row.offset_minutes,
    speakerId: row.speaker_id,
    sessionId: row.session_id,
    purpose: row.purpose,
    variant: row.variant,
    planVersion: row.plan_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listItems(db: D1Database, campaignId: number): Promise<ScheduleItem[]> {
  const { results } = await db
    .prepare("SELECT * FROM schedule_items WHERE campaign_id = ? ORDER BY due_at, id")
    .bind(campaignId)
    .all<ItemRow>();
  return results.map(toItem);
}

export async function getItem(
  db: D1Database,
  campaignId: number,
  id: number,
): Promise<ScheduleItem | null> {
  const row = await db
    .prepare("SELECT * FROM schedule_items WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .first<ItemRow>();
  return row ? toItem(row) : null;
}

const INSERT_SQL = `INSERT INTO schedule_items (campaign_id, kind, channel, due_at, title, note, assignee_user_id,
  reviewer_user_id, requires_approval, status, blocked_by, request_status, request_followup_at, derived_from_item_id,
  offset_minutes, speaker_id, session_id, purpose, variant, plan_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertStatement(
  db: D1Database,
  campaignId: number,
  input: ItemInput,
  parentId: number | null,
) {
  return db
    .prepare(`${INSERT_SQL} RETURNING id`)
    .bind(
      campaignId,
      input.kind,
      input.channel ?? null,
      input.dueAt,
      input.title,
      input.note ?? null,
      input.assigneeUserId ?? null,
      input.reviewerUserId ?? null,
      input.requiresApproval === false ? 0 : 1,
      input.status ?? "planned",
      JSON.stringify(input.blockedBy ?? []),
      input.requestStatus ?? null,
      input.requestFollowupAt ?? null,
      parentId,
      input.offsetMinutes ?? null,
      input.speakerId ?? null,
      input.sessionId ?? null,
      input.purpose ?? null,
      input.variant ?? null,
      input.planVersion ?? null,
    );
}

/** Insert an item and the items the Playbook derives from it. Returns the parent id. */
export async function createItem(
  db: D1Database,
  campaignId: number,
  input: ItemInput,
  brief: Brief | null,
  options: { derive?: boolean } = {},
): Promise<number> {
  const [parent] = await db.batch<{ id: number }>([insertStatement(db, campaignId, input, null)]);
  const id = parent?.results?.[0]?.id;
  if (typeof id !== "number") throw new Error("schedule item insert returned no id");
  const derived = options.derive === false ? [] : deriveItems(input, brief, constants);
  if (derived.length) {
    await db.batch(
      derived.map((child) =>
        insertStatement(
          db,
          campaignId,
          {
            ...child,
            planVersion: input.planVersion ?? null,
            assigneeUserId: child.assigneeUserId ?? null,
          },
          id,
        ),
      ),
    );
  }
  return id;
}

/** Insert an item that is itself derived (from a plan), without deriving further. */
export async function createDerivedItem(
  db: D1Database,
  campaignId: number,
  input: ItemInput,
  parentId: number,
): Promise<number> {
  const [row] = await db.batch<{ id: number }>([insertStatement(db, campaignId, input, parentId)]);
  const id = row?.results?.[0]?.id;
  if (typeof id !== "number") throw new Error("schedule item insert returned no id");
  return id;
}

export type ItemPatch = Partial<
  Pick<
    ScheduleItem,
    | "kind"
    | "channel"
    | "dueAt"
    | "title"
    | "note"
    | "assigneeUserId"
    | "reviewerUserId"
    | "status"
    | "blockedBy"
    | "requestStatus"
    | "requestFollowupAt"
    | "speakerId"
    | "sessionId"
    | "draftId"
    | "externalRef"
    | "purpose"
    | "variant"
  >
>;

const COLUMNS: Record<keyof ItemPatch, string> = {
  kind: "kind",
  channel: "channel",
  dueAt: "due_at",
  title: "title",
  note: "note",
  assigneeUserId: "assignee_user_id",
  reviewerUserId: "reviewer_user_id",
  status: "status",
  blockedBy: "blocked_by",
  requestStatus: "request_status",
  requestFollowupAt: "request_followup_at",
  speakerId: "speaker_id",
  sessionId: "session_id",
  draftId: "draft_id",
  externalRef: "external_ref",
  purpose: "purpose",
  variant: "variant",
};

/**
 * Update an item. When its time moves, derived items move with it, keeping their own
 * offset_minutes (a derived item edited by hand keeps its offset, not its old time).
 */
export async function updateItem(
  db: D1Database,
  campaignId: number,
  id: number,
  patch: ItemPatch,
): Promise<void> {
  const keys = (Object.keys(patch) as (keyof ItemPatch)[]).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  const values = keys.map((k) => {
    const value = patch[k];
    if (k === "blockedBy" || k === "externalRef")
      return value === null ? null : JSON.stringify(value);
    return value ?? null;
  });
  const statements = [
    db
      .prepare(
        `UPDATE schedule_items SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(", ")}, updated_at = unixepoch()
         WHERE campaign_id = ? AND id = ?`,
      )
      .bind(...values, campaignId, id),
  ];
  if (patch.dueAt !== undefined) {
    statements.push(
      db
        .prepare(
          `UPDATE schedule_items SET due_at = ? + offset_minutes * 60, updated_at = unixepoch()
           WHERE campaign_id = ? AND derived_from_item_id = ? AND offset_minutes IS NOT NULL`,
        )
        .bind(patch.dueAt, campaignId, id),
    );
  }
  await db.batch(statements);
}

/** Compare-and-set on status, so a double click or an overlapping cron cannot run a step twice. */
export async function transitionItem(
  db: D1Database,
  id: number,
  from: ItemStatus[],
  to: ItemStatus,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE schedule_items SET status = ?, updated_at = unixepoch()
       WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`,
    )
    .bind(to, id, ...from)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteItem(db: D1Database, campaignId: number, id: number): Promise<void> {
  await db
    .prepare("DELETE FROM schedule_items WHERE campaign_id = ? AND id = ?")
    .bind(campaignId, id)
    .run();
}

/** Items assigned to or reviewed by a user, across campaigns, open only. */
export async function listItemsForUser(
  db: D1Database,
  userId: string,
): Promise<(ScheduleItem & { campaignSlug: string; campaignName: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT i.*, c.slug AS campaign_slug, c.name AS campaign_name FROM schedule_items i
       JOIN campaigns c ON c.id = i.campaign_id
       WHERE (i.assignee_user_id = ? OR i.reviewer_user_id = ?)
         AND i.status NOT IN ('done','skipped') AND c.status != 'closed'
       ORDER BY i.due_at LIMIT 200`,
    )
    .bind(userId, userId)
    .all<ItemRow & { campaign_slug: string; campaign_name: string }>();
  return results.map((row) => ({
    ...toItem(row),
    campaignSlug: row.campaign_slug,
    campaignName: row.campaign_name,
  }));
}

/** Items of open campaigns whose time has come, for the minute cron (one SQL filter each). */
export async function dueItems(
  db: D1Database,
  where: string,
  binds: unknown[],
  limit = 50,
): Promise<ScheduleItem[]> {
  const { results } = await db
    .prepare(
      `SELECT i.* FROM schedule_items i JOIN campaigns c ON c.id = i.campaign_id
       WHERE c.status != 'closed' AND ${where} ORDER BY i.due_at LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<ItemRow>();
  return results.map(toItem);
}

export async function setRequestStatus(
  db: D1Database,
  campaignId: number,
  id: number,
  status: ScheduleItem["requestStatus"],
  followupAt: number | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE schedule_items SET request_status = ?, request_followup_at = ?,
         status = CASE WHEN ? IN ('replied','declined') THEN 'done' ELSE status END,
         updated_at = unixepoch()
       WHERE campaign_id = ? AND id = ?`,
    )
    .bind(status, followupAt, status, campaignId, id)
    .run();
}
