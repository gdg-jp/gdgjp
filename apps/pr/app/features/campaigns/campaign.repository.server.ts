import type { Campaign, CampaignChapter, CampaignMember, MemberRole } from "./campaign";
import { parseRoles } from "./campaign";

type CampaignRow = {
  id: number;
  chapter_id: number;
  chapter_slug: string;
  parent_campaign_id: number | null;
  slug: string;
  name: string;
  event_at: number | null;
  venue: string | null;
  status: Campaign["status"];
  connpass_group_slug: string | null;
  connpass_event_id: string | null;
  tinyurl_campaign_id: number | null;
  budget_total_yen: number;
  auto_staff_reminders?: number;
  playbook_version: string;
  created_by: string;
  created_at: number;
  updated_at: number;
};

export function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    chapterSlug: row.chapter_slug,
    parentCampaignId: row.parent_campaign_id,
    slug: row.slug,
    name: row.name,
    eventAt: row.event_at,
    venue: row.venue,
    status: row.status,
    connpassGroupSlug: row.connpass_group_slug,
    connpassEventId: row.connpass_event_id,
    tinyurlCampaignId: row.tinyurl_campaign_id,
    budgetTotalYen: row.budget_total_yen,
    autoStaffReminders: row.auto_staff_reminders === 1,
    playbookVersion: row.playbook_version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Campaigns hosted or co-hosted by any of the chapters. */
export async function listCampaignsForChapters(
  db: D1Database,
  chapterIds: number[],
  all = false,
): Promise<Campaign[]> {
  if (!all && chapterIds.length === 0) return [];
  const filter = all
    ? ""
    : `WHERE c.chapter_id IN (${chapterIds.map(() => "?").join(",")})
        OR c.id IN (SELECT campaign_id FROM campaign_chapters WHERE chapter_id IN (${chapterIds.map(() => "?").join(",")}))`;
  const { results } = await db
    .prepare(
      `SELECT c.* FROM campaigns c ${filter}
       ORDER BY c.status = 'closed', COALESCE(c.event_at, 9999999999), c.id DESC`,
    )
    .bind(...(all ? [] : [...chapterIds, ...chapterIds]))
    .all<CampaignRow>();
  return results.map(toCampaign);
}

export async function getCampaignBySlug(db: D1Database, slug: string): Promise<Campaign | null> {
  const row = await db
    .prepare("SELECT * FROM campaigns WHERE slug = ?")
    .bind(slug)
    .first<CampaignRow>();
  return row ? toCampaign(row) : null;
}

export async function getCampaignById(db: D1Database, id: number): Promise<Campaign | null> {
  const row = await db
    .prepare("SELECT * FROM campaigns WHERE id = ?")
    .bind(id)
    .first<CampaignRow>();
  return row ? toCampaign(row) : null;
}

export async function listCampaignChapters(
  db: D1Database,
  campaignId: number,
): Promise<CampaignChapter[]> {
  const { results } = await db
    .prepare(
      "SELECT chapter_id, chapter_slug, role FROM campaign_chapters WHERE campaign_id = ? ORDER BY role = 'co-host', chapter_slug",
    )
    .bind(campaignId)
    .all<{ chapter_id: number; chapter_slug: string; role: CampaignChapter["role"] }>();
  return results.map((r) => ({
    chapterId: r.chapter_id,
    chapterSlug: r.chapter_slug,
    role: r.role,
  }));
}

export type NewCampaign = {
  chapterId: number;
  chapterSlug: string;
  parentCampaignId: number | null;
  slug: string;
  name: string;
  eventAt: number | null;
  venue: string | null;
  budgetTotalYen: number;
  playbookVersion: string;
  creator: { id: string; name: string; email: string };
};

/** Campaign + its host chapter + the creator as lead, in one batch. */
export async function insertCampaign(
  db: D1Database,
  input: NewCampaign,
): Promise<{ ok: true; id: number } | { ok: false; reason: "slug_taken" }> {
  try {
    const [inserted] = await db.batch<{ id: number }>([
      db
        .prepare(
          `INSERT INTO campaigns (chapter_id, chapter_slug, parent_campaign_id, slug, name, event_at, venue,
             budget_total_yen, playbook_version, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(
          input.chapterId,
          input.chapterSlug,
          input.parentCampaignId,
          input.slug,
          input.name,
          input.eventAt,
          input.venue,
          input.budgetTotalYen,
          input.playbookVersion,
          input.creator.id,
        ),
      db
        .prepare(
          `INSERT INTO campaign_chapters (campaign_id, chapter_id, chapter_slug, role)
           SELECT id, ?, ?, 'host' FROM campaigns WHERE slug = ?`,
        )
        .bind(input.chapterId, input.chapterSlug, input.slug),
      db
        .prepare(
          `INSERT INTO campaign_members (campaign_id, user_id, name, email, roles, added_by)
           SELECT id, ?, ?, ?, '["lead"]', ? FROM campaigns WHERE slug = ?`,
        )
        .bind(
          input.creator.id,
          input.creator.name,
          input.creator.email,
          input.creator.id,
          input.slug,
        ),
    ]);
    const id = inserted?.results?.[0]?.id;
    if (typeof id !== "number") throw new Error("campaign insert returned no id");
    return { ok: true, id };
  } catch (error) {
    if (String(error).includes("UNIQUE")) return { ok: false, reason: "slug_taken" };
    throw error;
  }
}

export type CampaignSettings = Partial<
  Pick<
    Campaign,
    | "name"
    | "status"
    | "connpassGroupSlug"
    | "connpassEventId"
    | "budgetTotalYen"
    | "eventAt"
    | "venue"
    | "parentCampaignId"
    | "autoStaffReminders"
  >
>;

const SETTING_COLUMNS: Record<keyof CampaignSettings, string> = {
  name: "name",
  status: "status",
  connpassGroupSlug: "connpass_group_slug",
  connpassEventId: "connpass_event_id",
  budgetTotalYen: "budget_total_yen",
  eventAt: "event_at",
  venue: "venue",
  parentCampaignId: "parent_campaign_id",
  autoStaffReminders: "auto_staff_reminders",
};

export async function updateCampaign(
  db: D1Database,
  id: number,
  patch: CampaignSettings,
): Promise<void> {
  const keys = (Object.keys(patch) as (keyof CampaignSettings)[]).filter(
    (k) => patch[k] !== undefined,
  );
  if (keys.length === 0) return;
  await db
    .prepare(
      `UPDATE campaigns SET ${keys.map((k) => `${SETTING_COLUMNS[k]} = ?`).join(", ")}, updated_at = unixepoch() WHERE id = ?`,
    )
    .bind(
      ...keys.map((k) => {
        const value = patch[k];
        return typeof value === "boolean" ? (value ? 1 : 0) : (value ?? null);
      }),
      id,
    )
    .run();
}

export async function addCoHost(
  db: D1Database,
  campaignId: number,
  chapterId: number,
  chapterSlug: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO campaign_chapters (campaign_id, chapter_id, chapter_slug, role) VALUES (?, ?, ?, 'co-host')
       ON CONFLICT (campaign_id, chapter_id) DO NOTHING`,
    )
    .bind(campaignId, chapterId, chapterSlug)
    .run();
}

export async function removeCoHost(
  db: D1Database,
  campaignId: number,
  chapterId: number,
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM campaign_chapters WHERE campaign_id = ? AND chapter_id = ? AND role = 'co-host'",
    )
    .bind(campaignId, chapterId)
    .run();
}

type MemberRow = {
  user_id: string;
  name: string;
  email: string;
  roles: string;
  discord_handle: string | null;
};

export async function listMembers(db: D1Database, campaignId: number): Promise<CampaignMember[]> {
  const { results } = await db
    .prepare(
      "SELECT user_id, name, email, roles, discord_handle FROM campaign_members WHERE campaign_id = ? ORDER BY created_at",
    )
    .bind(campaignId)
    .all<MemberRow>();
  return results.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    roles: parseRoles(r.roles),
    discordHandle: r.discord_handle,
  }));
}

export async function upsertMember(
  db: D1Database,
  campaignId: number,
  member: {
    userId: string;
    name: string;
    email: string;
    roles: MemberRole[];
    discordHandle: string | null;
  },
  addedBy: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO campaign_members (campaign_id, user_id, name, email, roles, discord_handle, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (campaign_id, user_id) DO UPDATE SET
         name = excluded.name, email = excluded.email, roles = excluded.roles, discord_handle = excluded.discord_handle`,
    )
    .bind(
      campaignId,
      member.userId,
      member.name,
      member.email,
      JSON.stringify(member.roles),
      member.discordHandle,
      addedBy,
    )
    .run();
}

export async function removeMember(
  db: D1Database,
  campaignId: number,
  userId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?")
    .bind(campaignId, userId)
    .run();
}

/** Users who have signed in to pr (the gdg-lib user cache): the pool members are picked from. */
export async function listKnownUsers(
  db: D1Database,
): Promise<{ id: string; name: string; email: string }[]> {
  const { results } = await db
    .prepare('SELECT id, name, email FROM "user" ORDER BY name LIMIT 500')
    .all<{ id: string; name: string; email: string }>();
  return results;
}

/** Keep the member's live claims so the precheck can ask sns about them later. */
export async function recordMemberClaims(
  db: D1Database,
  campaignId: number,
  userId: string,
  claims: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE campaign_members SET claims_snapshot = ?
       WHERE campaign_id = ? AND user_id = ? AND claims_snapshot IS NOT ?`,
    )
    .bind(claims, campaignId, userId, claims)
    .run();
}

export async function listMemberClaims(
  db: D1Database,
  campaignId: number,
): Promise<{ userId: string; name: string; claims: string | null }[]> {
  const { results } = await db
    .prepare("SELECT user_id, name, claims_snapshot FROM campaign_members WHERE campaign_id = ?")
    .bind(campaignId)
    .all<{ user_id: string; name: string; claims_snapshot: string | null }>();
  return results.map((r) => ({ userId: r.user_id, name: r.name, claims: r.claims_snapshot }));
}

/** The `{ user, chapters }` cron calls to tinyurl act for (whoever last activated). */
export async function setActorSnapshot(db: D1Database, id: number, actor: string): Promise<void> {
  await db
    .prepare("UPDATE campaigns SET actor_snapshot = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(actor, id)
    .run();
}

export async function getActorSnapshot(db: D1Database, id: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT actor_snapshot FROM campaigns WHERE id = ?")
    .bind(id)
    .first<{ actor_snapshot: string | null }>();
  return row?.actor_snapshot ?? null;
}

export async function setTinyurlCampaign(db: D1Database, id: number, tinyurlId: number) {
  await db
    .prepare("UPDATE campaigns SET tinyurl_campaign_id = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(tinyurlId, id)
    .run();
}
