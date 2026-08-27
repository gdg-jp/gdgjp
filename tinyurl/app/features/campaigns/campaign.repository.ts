import { type Link, listLinksForCampaign } from "~/lib/db";
import type {
  Campaign,
  CampaignChannel,
  CampaignChannelSource,
  CampaignChannelWithLinks,
  CampaignWithChannelLinks,
  CampaignWithCounts,
} from "./campaign.types";

type CampaignRow = {
  id: number;
  name: string;
  code: string;
  default_destination_url: string | null;
  owner_user_id: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

type CampaignWithCountsRow = CampaignRow & {
  channel_count: number;
  link_count: number;
};

const CAMPAIGN_COLS =
  "id, name, code, default_destination_url, owner_user_id, created_at, updated_at, archived_at";

export function toCampaign(row: CampaignRow, chapterIds: number[] = []): Campaign {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    defaultDestinationUrl: row.default_destination_url,
    ownerUserId: row.owner_user_id,
    chapterIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

type CampaignChannelRow = {
  id: number;
  campaign_id: number;
  name: string;
  code: string;
  sort_order: number;
  archived_at: number | null;
};

const CAMPAIGN_CHANNEL_COLS = "id, campaign_id, name, code, sort_order, archived_at";

export function toCampaignChannel(row: CampaignChannelRow): CampaignChannel {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    code: row.code,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  };
}

type CampaignChannelSourceRow = {
  id: number;
  channel_id: number;
  name: string;
  code: string;
  archived_at: number | null;
};

const CAMPAIGN_SOURCE_COLS = "id, channel_id, name, code, archived_at";

export function toCampaignChannelSource(row: CampaignChannelSourceRow): CampaignChannelSource {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    code: row.code,
    archivedAt: row.archived_at,
  };
}

export function normalizeCampaignCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) {
    throw new RangeError("Code must be 1-32 lowercase letters, numbers, underscores, or hyphens");
  }
  return normalized;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE") || message.includes("unique constraint");
}

// ---------- Campaigns ----------

export async function listCampaignsForChapterWithCounts(
  db: D1Database,
  chapterId: number,
  includeArchived = false,
): Promise<CampaignWithCounts[]> {
  const { results } = await db
    .prepare(
      `SELECT c.${CAMPAIGN_COLS.split(", ").join(", c.")},
              COUNT(DISTINCT m.id) AS channel_count,
              COUNT(DISTINCT l.id) AS link_count
       FROM campaigns c
       JOIN campaign_chapters cc ON cc.campaign_id = c.id
       LEFT JOIN campaign_channels m ON m.campaign_id = c.id
       LEFT JOIN links l ON l.campaign_channel_id = m.id
         AND l.archived_at IS NULL AND l.deleted_at IS NULL
       WHERE cc.chapter_id = ? AND (? = 1 OR c.archived_at IS NULL)
       GROUP BY c.id
       ORDER BY c.archived_at IS NOT NULL, c.created_at DESC`,
    )
    .bind(chapterId, includeArchived ? 1 : 0)
    .all<CampaignWithCountsRow>();
  const chapterIdsByCampaign = await listCampaignChapterIds(
    db,
    results.map((row) => row.id),
  );
  return results.map((row) => ({
    ...toCampaign(row, chapterIdsByCampaign.get(row.id) ?? []),
    channelCount: row.channel_count,
    linkCount: row.link_count,
  }));
}

export async function listCampaignsForChaptersWithCounts(
  db: D1Database,
  chapterIds: number[],
  includeArchived = false,
): Promise<CampaignWithCounts[]> {
  const ids = [...new Set(chapterIds)];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT c.${CAMPAIGN_COLS.split(", ").join(", c.")},
              COUNT(DISTINCT m.id) AS channel_count,
              COUNT(DISTINCT l.id) AS link_count
       FROM campaigns c
       JOIN campaign_chapters cc ON cc.campaign_id = c.id
       LEFT JOIN campaign_channels m ON m.campaign_id = c.id
       LEFT JOIN links l ON l.campaign_channel_id = m.id
         AND l.archived_at IS NULL AND l.deleted_at IS NULL
       WHERE cc.chapter_id IN (${placeholders}) AND (? = 1 OR c.archived_at IS NULL)
       GROUP BY c.id
       ORDER BY c.archived_at IS NOT NULL, c.created_at DESC`,
    )
    .bind(...ids, includeArchived ? 1 : 0)
    .all<CampaignWithCountsRow>();
  const chapterIdsByCampaign = await listCampaignChapterIds(
    db,
    results.map((row) => row.id),
  );
  return results.map((row) => ({
    ...toCampaign(row, chapterIdsByCampaign.get(row.id) ?? []),
    channelCount: row.channel_count,
    linkCount: row.link_count,
  }));
}

export async function getCampaignById(db: D1Database, id: number): Promise<Campaign | null> {
  const row = await db
    .prepare(`SELECT ${CAMPAIGN_COLS} FROM campaigns WHERE id = ?`)
    .bind(id)
    .first<CampaignRow>();
  if (!row) return null;
  const chapterIds = await listCampaignChapterIds(db, [id]);
  return toCampaign(row, chapterIds.get(id) ?? []);
}

async function listCampaignChapterIds(
  db: D1Database,
  campaignIds: number[],
): Promise<Map<number, number[]>> {
  if (campaignIds.length === 0) return new Map();
  const placeholders = campaignIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT campaign_id, chapter_id FROM campaign_chapters
       WHERE campaign_id IN (${placeholders}) ORDER BY chapter_id`,
    )
    .bind(...campaignIds)
    .all<{ campaign_id: number; chapter_id: number }>();
  const values = new Map<number, number[]>();
  for (const row of results) {
    const ids = values.get(row.campaign_id) ?? [];
    ids.push(row.chapter_id);
    values.set(row.campaign_id, ids);
  }
  return values;
}

export type CreateCampaignInput = {
  name: string;
  code: string;
  defaultDestinationUrl?: string | null;
  ownerUserId: string;
  chapterIds: number[];
};

export type CampaignWriteResult =
  | { ok: true; campaign: Campaign }
  | { ok: false; reason: "code_taken" };

export async function createCampaign(
  db: D1Database,
  input: CreateCampaignInput,
): Promise<CampaignWriteResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO campaigns
           (name, code, default_destination_url, owner_user_id)
         VALUES (?, ?, ?, ?) RETURNING ${CAMPAIGN_COLS}`,
      )
      .bind(
        input.name.trim(),
        normalizeCampaignCode(input.code),
        input.defaultDestinationUrl ?? null,
        input.ownerUserId,
      )
      .first<CampaignRow>();
    if (!row) throw new Error("Insert returned no row");
    const chapterIds = [...new Set(input.chapterIds)];
    if (chapterIds.length === 0) throw new RangeError("A campaign must have at least one chapter");
    await db.batch([
      ...chapterIds.map((chapterId) =>
        db
          .prepare("INSERT INTO campaign_chapters (campaign_id, chapter_id) VALUES (?, ?)")
          .bind(row.id, chapterId),
      ),
      db
        .prepare(
          `INSERT INTO campaign_channels (campaign_id, name, code, sort_order)
             VALUES (?, 'その他', 'other', 2147483647)`,
        )
        .bind(row.id),
    ]);
    return { ok: true, campaign: toCampaign(row, chapterIds) };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "code_taken" };
    throw error;
  }
}

export async function updateCampaign(
  db: D1Database,
  id: number,
  input: {
    name?: string;
    code?: string;
    defaultDestinationUrl?: string | null;
    chapterIds?: number[];
  },
): Promise<CampaignWriteResult | null> {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    values.push(input.name.trim());
  }
  if (input.code !== undefined) {
    sets.push("code = ?");
    values.push(normalizeCampaignCode(input.code));
  }
  if (input.defaultDestinationUrl !== undefined) {
    sets.push("default_destination_url = ?");
    values.push(input.defaultDestinationUrl);
  }
  if (input.chapterIds !== undefined && input.chapterIds.length === 0) {
    throw new RangeError("A campaign must have at least one chapter");
  }
  if (sets.length === 0 && input.chapterIds === undefined) {
    const campaign = await getCampaignById(db, id);
    return campaign ? { ok: true, campaign } : null;
  }
  sets.push("updated_at = unixepoch()");
  try {
    const row = await db
      .prepare(`UPDATE campaigns SET ${sets.join(", ")} WHERE id = ? RETURNING ${CAMPAIGN_COLS}`)
      .bind(...values, id)
      .first<CampaignRow>();
    if (!row) return null;
    if (input.chapterIds !== undefined) {
      const chapterIds = [...new Set(input.chapterIds)];
      await db.batch([
        db.prepare("DELETE FROM campaign_chapters WHERE campaign_id = ?").bind(id),
        ...chapterIds.map((chapterId) =>
          db
            .prepare("INSERT INTO campaign_chapters (campaign_id, chapter_id) VALUES (?, ?)")
            .bind(id, chapterId),
        ),
      ]);
      return { ok: true, campaign: toCampaign(row, chapterIds) };
    }
    const chapterIds = await listCampaignChapterIds(db, [id]);
    return { ok: true, campaign: toCampaign(row, chapterIds.get(id) ?? []) };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "code_taken" };
    throw error;
  }
}

export async function archiveCampaign(
  db: D1Database,
  id: number,
  archived = true,
): Promise<Campaign | null> {
  const row = await db
    .prepare(
      `UPDATE campaigns
       SET archived_at = CASE WHEN ? = 1 THEN unixepoch() ELSE NULL END,
           updated_at = unixepoch()
       WHERE id = ? RETURNING ${CAMPAIGN_COLS}`,
    )
    .bind(archived ? 1 : 0, id)
    .first<CampaignRow>();
  if (!row) return null;
  const chapterIds = await listCampaignChapterIds(db, [id]);
  return toCampaign(row, chapterIds.get(id) ?? []);
}

export async function deleteCampaign(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM campaigns WHERE id = ?").bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

// ---------- Channels ----------

export async function listCampaignChannels(
  db: D1Database,
  campaignId: number,
  includeArchived = false,
): Promise<CampaignChannel[]> {
  const { results } = await db
    .prepare(
      `SELECT ${CAMPAIGN_CHANNEL_COLS} FROM campaign_channels
       WHERE campaign_id = ? AND (? = 1 OR archived_at IS NULL)
       ORDER BY archived_at IS NOT NULL, sort_order, id`,
    )
    .bind(campaignId, includeArchived ? 1 : 0)
    .all<CampaignChannelRow>();
  return results.map(toCampaignChannel);
}

export async function getCampaignChannelById(
  db: D1Database,
  id: number,
): Promise<CampaignChannel | null> {
  const row = await db
    .prepare(`SELECT ${CAMPAIGN_CHANNEL_COLS} FROM campaign_channels WHERE id = ?`)
    .bind(id)
    .first<CampaignChannelRow>();
  return row ? toCampaignChannel(row) : null;
}

export type CampaignChannelWriteResult =
  | { ok: true; channel: CampaignChannel }
  | { ok: false; reason: "code_taken" };

export async function createCampaignChannel(
  db: D1Database,
  input: { campaignId: number; name: string; code: string; sortOrder?: number },
): Promise<CampaignChannelWriteResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO campaign_channels (campaign_id, name, code, sort_order)
         VALUES (?, ?, ?, ?) RETURNING ${CAMPAIGN_CHANNEL_COLS}`,
      )
      .bind(
        input.campaignId,
        input.name.trim(),
        normalizeCampaignCode(input.code),
        input.sortOrder ?? 0,
      )
      .first<CampaignChannelRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, channel: toCampaignChannel(row) };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "code_taken" };
    throw error;
  }
}

export async function updateCampaignChannel(
  db: D1Database,
  id: number,
  input: { name?: string; code?: string; sortOrder?: number },
): Promise<CampaignChannelWriteResult | null> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    values.push(input.name.trim());
  }
  if (input.code !== undefined) {
    sets.push("code = ?");
    values.push(normalizeCampaignCode(input.code));
  }
  if (input.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    values.push(input.sortOrder);
  }
  if (sets.length === 0) {
    const channel = await getCampaignChannelById(db, id);
    return channel ? { ok: true, channel } : null;
  }
  try {
    const row = await db
      .prepare(
        `UPDATE campaign_channels SET ${sets.join(", ")} WHERE id = ?
         RETURNING ${CAMPAIGN_CHANNEL_COLS}`,
      )
      .bind(...values, id)
      .first<CampaignChannelRow>();
    return row ? { ok: true, channel: toCampaignChannel(row) } : null;
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "code_taken" };
    throw error;
  }
}

export async function archiveCampaignChannel(
  db: D1Database,
  id: number,
  archived = true,
): Promise<CampaignChannel | null> {
  const row = await db
    .prepare(
      `UPDATE campaign_channels
       SET archived_at = CASE WHEN ? = 1 THEN unixepoch() ELSE NULL END
       WHERE id = ? RETURNING ${CAMPAIGN_CHANNEL_COLS}`,
    )
    .bind(archived ? 1 : 0, id)
    .first<CampaignChannelRow>();
  return row ? toCampaignChannel(row) : null;
}

export async function deleteCampaignChannel(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM campaign_channels WHERE id = ?").bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

// ---------- Sources ----------

export async function listCampaignChannelSources(
  db: D1Database,
  channelId: number,
  includeArchived = false,
): Promise<CampaignChannelSource[]> {
  const { results } = await db
    .prepare(
      `SELECT ${CAMPAIGN_SOURCE_COLS} FROM campaign_channel_sources
       WHERE channel_id = ? AND (? = 1 OR archived_at IS NULL)
       ORDER BY archived_at IS NOT NULL, name, id`,
    )
    .bind(channelId, includeArchived ? 1 : 0)
    .all<CampaignChannelSourceRow>();
  return results.map(toCampaignChannelSource);
}

async function listCampaignChannelSourcesForCampaign(
  db: D1Database,
  campaignId: number,
  includeArchived = false,
): Promise<CampaignChannelSource[]> {
  const sourceCols = CAMPAIGN_SOURCE_COLS.split(", ")
    .map((column) => `s.${column}`)
    .join(", ");
  const { results } = await db
    .prepare(
      `SELECT ${sourceCols} FROM campaign_channel_sources s
       JOIN campaign_channels m ON m.id = s.channel_id
       WHERE m.campaign_id = ? AND (? = 1 OR s.archived_at IS NULL)
       ORDER BY s.archived_at IS NOT NULL, s.name, s.id`,
    )
    .bind(campaignId, includeArchived ? 1 : 0)
    .all<CampaignChannelSourceRow>();
  return results.map(toCampaignChannelSource);
}

export async function getCampaignChannelSourceById(
  db: D1Database,
  id: number,
): Promise<CampaignChannelSource | null> {
  const row = await db
    .prepare(`SELECT ${CAMPAIGN_SOURCE_COLS} FROM campaign_channel_sources WHERE id = ?`)
    .bind(id)
    .first<CampaignChannelSourceRow>();
  return row ? toCampaignChannelSource(row) : null;
}

export type CampaignChannelSourceWriteResult =
  | { ok: true; source: CampaignChannelSource }
  | { ok: false; reason: "code_taken" };

export async function createCampaignChannelSource(
  db: D1Database,
  input: { channelId: number; name: string; code: string },
): Promise<CampaignChannelSourceWriteResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO campaign_channel_sources (channel_id, name, code)
         VALUES (?, ?, ?) RETURNING ${CAMPAIGN_SOURCE_COLS}`,
      )
      .bind(input.channelId, input.name.trim(), normalizeCampaignCode(input.code))
      .first<CampaignChannelSourceRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, source: toCampaignChannelSource(row) };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "code_taken" };
    throw error;
  }
}

export async function updateCampaignChannelSource(
  db: D1Database,
  id: number,
  input: { name?: string; code?: string },
): Promise<CampaignChannelSourceWriteResult | null> {
  const sets: string[] = [];
  const values: string[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    values.push(input.name.trim());
  }
  if (input.code !== undefined) {
    sets.push("code = ?");
    values.push(normalizeCampaignCode(input.code));
  }
  if (sets.length === 0) {
    const source = await getCampaignChannelSourceById(db, id);
    return source ? { ok: true, source } : null;
  }
  try {
    const row = await db
      .prepare(
        `UPDATE campaign_channel_sources SET ${sets.join(", ")} WHERE id = ?
         RETURNING ${CAMPAIGN_SOURCE_COLS}`,
      )
      .bind(...values, id)
      .first<CampaignChannelSourceRow>();
    return row ? { ok: true, source: toCampaignChannelSource(row) } : null;
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "code_taken" };
    throw error;
  }
}

export async function archiveCampaignChannelSource(
  db: D1Database,
  id: number,
  archived = true,
): Promise<CampaignChannelSource | null> {
  const row = await db
    .prepare(
      `UPDATE campaign_channel_sources
       SET archived_at = CASE WHEN ? = 1 THEN unixepoch() ELSE NULL END
       WHERE id = ?
       RETURNING ${CAMPAIGN_SOURCE_COLS}`,
    )
    .bind(archived ? 1 : 0, id)
    .first<CampaignChannelSourceRow>();
  return row ? toCampaignChannelSource(row) : null;
}

export async function deleteCampaignChannelSource(db: D1Database, id: number): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM campaign_channel_sources WHERE id = ?")
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

// ---------- Aggregate reads ----------

export async function listCampaignChannelsWithLinks(
  db: D1Database,
  campaignId: number,
  includeArchived = false,
): Promise<CampaignChannelWithLinks[]> {
  const [channels, sources, links] = await Promise.all([
    listCampaignChannels(db, campaignId, includeArchived),
    listCampaignChannelSourcesForCampaign(db, campaignId, includeArchived),
    listLinksForCampaign(db, campaignId),
  ]);
  const sourcesByChannel = new Map<number, CampaignChannelSource[]>();
  for (const source of sources) {
    const values = sourcesByChannel.get(source.channelId) ?? [];
    values.push(source);
    sourcesByChannel.set(source.channelId, values);
  }
  const linksByChannel = new Map<number, Link[]>();
  for (const link of links) {
    if (link.campaignChannelId === null) continue;
    const values = linksByChannel.get(link.campaignChannelId) ?? [];
    values.push(link);
    linksByChannel.set(link.campaignChannelId, values);
  }
  return channels.map((channel) => ({
    ...channel,
    sources: sourcesByChannel.get(channel.id) ?? [],
    links: linksByChannel.get(channel.id) ?? [],
  }));
}

export async function getCampaignWithChannelLinks(
  db: D1Database,
  campaignId: number,
  includeArchived = false,
): Promise<CampaignWithChannelLinks | null> {
  const [campaign, channels] = await Promise.all([
    getCampaignById(db, campaignId),
    listCampaignChannelsWithLinks(db, campaignId, includeArchived),
  ]);
  if (!campaign) return null;
  return { ...campaign, channels };
}

// ---------- CLI cursor pagination ----------

export type CursorPage<T> = { items: T[]; nextCursor: string | null };

/** Parses an opaque id cursor. Returns undefined for a malformed token, distinct from "no cursor" (null). */
export function parseIdCursor(cursor: string): number | undefined {
  const value = Number(cursor);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function listCampaignsForCallerPage(
  db: D1Database,
  scope: { isSuperAdmin: boolean; chapterIds: number[] },
  options: { includeArchived?: boolean; limit?: number; cursor?: number | null } = {},
): Promise<CursorPage<CampaignWithCounts>> {
  const limit = options.limit ?? 20;
  const includeArchived = options.includeArchived ?? false;
  const cursor = options.cursor ?? null;

  const conditions = ["(? = 1 OR c.archived_at IS NULL)"];
  const params: unknown[] = [includeArchived ? 1 : 0];
  if (cursor !== null) {
    conditions.push("c.id > ?");
    params.push(cursor);
  }

  let scopeJoin = "";
  if (!scope.isSuperAdmin) {
    const ids = [...new Set(scope.chapterIds)];
    if (ids.length === 0) return { items: [], nextCursor: null };
    const placeholders = ids.map(() => "?").join(", ");
    scopeJoin = "JOIN campaign_chapters cc ON cc.campaign_id = c.id";
    conditions.push(`cc.chapter_id IN (${placeholders})`);
    params.push(...ids);
  }

  const { results } = await db
    .prepare(
      `SELECT c.${CAMPAIGN_COLS.split(", ").join(", c.")},
              COUNT(DISTINCT m.id) AS channel_count,
              COUNT(DISTINCT l.id) AS link_count
       FROM campaigns c
       ${scopeJoin}
       LEFT JOIN campaign_channels m ON m.campaign_id = c.id
       LEFT JOIN links l ON l.campaign_channel_id = m.id
         AND l.archived_at IS NULL AND l.deleted_at IS NULL
       WHERE ${conditions.join(" AND ")}
       GROUP BY c.id
       ORDER BY c.id
       LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<CampaignWithCountsRow>();

  const rows = results.slice(0, limit);
  const chapterIdsByCampaign = await listCampaignChapterIds(
    db,
    rows.map((row) => row.id),
  );
  const items = rows.map((row) => ({
    ...toCampaign(row, chapterIdsByCampaign.get(row.id) ?? []),
    channelCount: row.channel_count,
    linkCount: row.link_count,
  }));
  const last = rows.at(-1);
  return {
    items,
    nextCursor: results.length > limit && last ? String(last.id) : null,
  };
}

export async function listCampaignChannelsPage(
  db: D1Database,
  campaignId: number,
  options: { includeArchived?: boolean; limit?: number; cursor?: number | null } = {},
): Promise<CursorPage<CampaignChannel>> {
  const limit = options.limit ?? 20;
  const includeArchived = options.includeArchived ?? false;
  const cursor = options.cursor ?? null;
  const conditions = ["campaign_id = ?", "(? = 1 OR archived_at IS NULL)"];
  const params: unknown[] = [campaignId, includeArchived ? 1 : 0];
  if (cursor !== null) {
    conditions.push("id > ?");
    params.push(cursor);
  }
  const { results } = await db
    .prepare(
      `SELECT ${CAMPAIGN_CHANNEL_COLS} FROM campaign_channels
       WHERE ${conditions.join(" AND ")}
       ORDER BY id
       LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<CampaignChannelRow>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return {
    items: rows.map(toCampaignChannel),
    nextCursor: results.length > limit && last ? String(last.id) : null,
  };
}

export async function listCampaignChannelSourcesPage(
  db: D1Database,
  channelId: number,
  options: { includeArchived?: boolean; limit?: number; cursor?: number | null } = {},
): Promise<CursorPage<CampaignChannelSource>> {
  const limit = options.limit ?? 20;
  const includeArchived = options.includeArchived ?? false;
  const cursor = options.cursor ?? null;
  const conditions = ["channel_id = ?", "(? = 1 OR archived_at IS NULL)"];
  const params: unknown[] = [channelId, includeArchived ? 1 : 0];
  if (cursor !== null) {
    conditions.push("id > ?");
    params.push(cursor);
  }
  const { results } = await db
    .prepare(
      `SELECT ${CAMPAIGN_SOURCE_COLS} FROM campaign_channel_sources
       WHERE ${conditions.join(" AND ")}
       ORDER BY id
       LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<CampaignChannelSourceRow>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return {
    items: rows.map(toCampaignChannelSource),
    nextCursor: results.length > limit && last ? String(last.id) : null,
  };
}
