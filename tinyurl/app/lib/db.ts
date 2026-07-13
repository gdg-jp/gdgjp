import { newLinkId } from "./id";

export type LinkVisibility = "private" | "public";

export type Link = {
  id: string;
  slug: string;
  destinationUrl: string;
  title: string | null;
  description: string | null;
  ogImageUrl: string | null;
  ownerUserId: string;
  ownerChapterId: number | null;
  campaignChannelId: number | null;
  visibility: LinkVisibility;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

type LinkRow = {
  id: string;
  slug: string;
  destination_url: string;
  title: string | null;
  description: string | null;
  og_image_url: string | null;
  owner_user_id: string;
  owner_chapter_id: number | null;
  campaign_channel_id: number | null;
  visibility: LinkVisibility;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export function toLink(row: LinkRow): Link {
  return {
    id: row.id,
    slug: row.slug,
    destinationUrl: row.destination_url,
    title: row.title,
    description: row.description,
    ogImageUrl: row.og_image_url,
    ownerUserId: row.owner_user_id,
    ownerChapterId: row.owner_chapter_id,
    campaignChannelId: row.campaign_channel_id,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const LINK_COLS =
  "id, slug, destination_url, title, description, og_image_url, owner_user_id, owner_chapter_id, campaign_channel_id, visibility, created_at, updated_at, deleted_at";

export async function listLinksForUser(db: D1Database, userId: string): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links WHERE owner_user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<LinkRow>();
  return results.map(toLink);
}

export async function listPublicLinks(db: D1Database): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links WHERE visibility = 'public' AND deleted_at IS NULL ORDER BY created_at DESC`,
    )
    .all<LinkRow>();
  return results.map(toLink);
}

export async function getLinkBySlug(db: D1Database, slug: string): Promise<Link | null> {
  const row = await db
    .prepare(`SELECT ${LINK_COLS} FROM links WHERE slug = ? AND deleted_at IS NULL`)
    .bind(slug)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export async function getLinkById(db: D1Database, id: string): Promise<Link | null> {
  const row = await db
    .prepare(`SELECT ${LINK_COLS} FROM links WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export type CreateLinkInput = {
  slug: string;
  destinationUrl: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  ownerUserId: string;
  ownerChapterId?: number | null;
  campaignChannelId?: number | null;
  visibility?: LinkVisibility;
};

export type CreateLinkResult = { ok: true; link: Link } | { ok: false; reason: "slug_taken" };

export async function createLink(
  db: D1Database,
  input: CreateLinkInput,
): Promise<CreateLinkResult> {
  const ownerChapterId = input.ownerChapterId ?? null;
  try {
    const row = await db
      .prepare(
        `INSERT INTO links (id, slug, destination_url, title, description, og_image_url, owner_user_id, owner_chapter_id, campaign_channel_id, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${LINK_COLS}`,
      )
      .bind(
        newLinkId(),
        input.slug,
        input.destinationUrl,
        input.title ?? null,
        input.description ?? null,
        input.ogImageUrl ?? null,
        input.ownerUserId,
        ownerChapterId,
        input.campaignChannelId ?? null,
        input.visibility ?? "private",
      )
      .first<LinkRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, link: toLink(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) return { ok: false, reason: "slug_taken" };
    throw err;
  }
}

export type UpdateLinkInput = {
  slug?: string;
  destinationUrl?: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  campaignChannelId?: number | null;
  visibility?: LinkVisibility;
};

export async function updateLink(
  db: D1Database,
  id: string,
  input: UpdateLinkInput,
): Promise<Link | null> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.slug !== undefined) {
    sets.push("slug = ?");
    values.push(input.slug);
  }
  if (input.destinationUrl !== undefined) {
    sets.push("destination_url = ?");
    values.push(input.destinationUrl);
  }
  if (input.title !== undefined) {
    sets.push("title = ?");
    values.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    values.push(input.description);
  }
  if (input.ogImageUrl !== undefined) {
    sets.push("og_image_url = ?");
    values.push(input.ogImageUrl);
  }
  if (input.campaignChannelId !== undefined) {
    sets.push("campaign_channel_id = ?");
    values.push(input.campaignChannelId);
  }
  if (input.visibility !== undefined) {
    sets.push("visibility = ?");
    values.push(input.visibility);
  }
  if (sets.length === 0) return getLinkById(db, id);
  sets.push("updated_at = unixepoch()");
  const row = await db
    .prepare(
      `UPDATE links SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL RETURNING ${LINK_COLS}`,
    )
    .bind(...values, id)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export async function softDeleteLink(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE links SET deleted_at = unixepoch() WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .run();
}

export async function deleteLink(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM links WHERE id = ?").bind(id).run();
}

// ---------- Campaigns ----------

export type Campaign = {
  id: number;
  name: string;
  code: string;
  defaultDestinationUrl: string | null;
  ownerUserId: string;
  chapterIds: number[];
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
};

export type CampaignWithCounts = Campaign & {
  channelCount: number;
  linkCount: number;
};

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

export type CampaignChannel = {
  id: number;
  campaignId: number;
  name: string;
  code: string;
  sortOrder: number;
  archivedAt: number | null;
};

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

export type CampaignChannelSource = {
  id: number;
  channelId: number;
  name: string;
  code: string;
  archivedAt: number | null;
};

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

export type CampaignChannelWithLinks = CampaignChannel & {
  sources: CampaignChannelSource[];
  links: Link[];
};

export type CampaignWithChannelLinks = Campaign & {
  channels: CampaignChannelWithLinks[];
};

export function normalizeCampaignCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) {
    throw new RangeError("Code must be 1-32 lowercase letters, numbers, underscores, or hyphens");
  }
  return normalized;
}

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
       LEFT JOIN links l ON l.campaign_channel_id = m.id AND l.deleted_at IS NULL
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
       LEFT JOIN links l ON l.campaign_channel_id = m.id AND l.deleted_at IS NULL
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
    await db.batch(
      chapterIds.map((chapterId) =>
        db
          .prepare("INSERT INTO campaign_chapters (campaign_id, chapter_id) VALUES (?, ?)")
          .bind(row.id, chapterId),
      ),
    );
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
  return row ? toCampaign(row) : null;
}

export async function deleteCampaign(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM campaigns WHERE id = ?").bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

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

export async function listLinksForCampaignChannel(
  db: D1Database,
  channelId: number,
): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links
       WHERE campaign_channel_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    )
    .bind(channelId)
    .all<LinkRow>();
  return results.map(toLink);
}

export async function listLinksForCampaign(db: D1Database, campaignId: number): Promise<Link[]> {
  const linkCols = LINK_COLS.split(", ")
    .map((column) => `l.${column}`)
    .join(", ");
  const { results } = await db
    .prepare(
      `SELECT ${linkCols} FROM links l
       JOIN campaign_channels m ON m.id = l.campaign_channel_id
       WHERE m.campaign_id = ? AND l.deleted_at IS NULL
       ORDER BY m.sort_order, l.created_at DESC`,
    )
    .bind(campaignId)
    .all<LinkRow>();
  return results.map(toLink);
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

export async function listLinksForChapter(db: D1Database, chapterId: number): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links
       WHERE owner_chapter_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    )
    .bind(chapterId)
    .all<LinkRow>();
  return results.map(toLink);
}

const EDITOR_PERMISSION_SQL = `EXISTS (
  SELECT 1 FROM link_permissions p
  WHERE p.link_id = links.id
    AND p.role = 'editor'
    AND (
      (p.principal_type = 'user' AND p.principal_id = ?)
      OR (p.principal_type = 'chapter' AND p.principal_id IN (
        SELECT value FROM json_each(?)
      ))
    )
)`;

export async function listAssignableLinksForCampaign(
  db: D1Database,
  input: {
    userId: string;
    email: string;
    chapterIds: number[];
    campaignId: number;
  },
): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links
       WHERE deleted_at IS NULL
         AND campaign_channel_id IS NULL
         AND (
           (owner_user_id = ? AND owner_chapter_id IS NULL)
           OR owner_chapter_id IN (
             SELECT chapter_id FROM campaign_chapters WHERE campaign_id = ?
           )
           OR ${EDITOR_PERMISSION_SQL}
         )
       ORDER BY campaign_channel_id IS NOT NULL, created_at DESC`,
    )
    .bind(input.userId, input.campaignId, input.email, JSON.stringify(input.chapterIds.map(String)))
    .all<LinkRow>();
  return results.map(toLink);
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

export type AssignLinksToChannelInput = {
  linkIds: string[];
  channelId: number;
  actorUserId: string;
  actorEmail: string;
  actorChapterId: number;
  actorChapterIds: number[];
};

export type AssignLinksToChannelResult = {
  assignedIds: string[];
  rejectedIds: string[];
};

export async function assignLinksToChannel(
  db: D1Database,
  input: AssignLinksToChannelInput,
): Promise<AssignLinksToChannelResult> {
  const linkIds = [...new Set(input.linkIds)];
  if (linkIds.length === 0) return { assignedIds: [], rejectedIds: [] };
  const channel = await db
    .prepare(
      `SELECT m.id
       FROM campaign_channels m
       WHERE m.id = ?`,
    )
    .bind(input.channelId)
    .first<{ id: number }>();
  if (!channel) return { assignedIds: [], rejectedIds: linkIds };

  const actorChapterIds = JSON.stringify(input.actorChapterIds.map(String));
  const statements = linkIds.map((linkId) =>
    db
      .prepare(
        `UPDATE links
         SET campaign_channel_id = ?,
             owner_chapter_id = COALESCE(owner_chapter_id, ?),
             updated_at = unixepoch()
         WHERE id = ? AND deleted_at IS NULL
           AND (owner_user_id = ? OR owner_chapter_id IN (
             SELECT chapter_id
             FROM campaign_chapters cc
             JOIN campaign_channels m ON m.campaign_id = cc.campaign_id
             WHERE m.id = ?
           ) OR ${EDITOR_PERMISSION_SQL})`,
      )
      .bind(
        input.channelId,
        input.actorChapterId,
        linkId,
        input.actorUserId,
        input.channelId,
        input.actorEmail,
        actorChapterIds,
      ),
  );
  const results = await db.batch(statements);
  const assignedIds = linkIds.filter((_, index) => (results[index]?.meta.changes ?? 0) > 0);
  const assignedSet = new Set(assignedIds);
  return {
    assignedIds,
    rejectedIds: linkIds.filter((id) => !assignedSet.has(id)),
  };
}

export async function unassignLinksFromCampaign(
  db: D1Database,
  linkIds: string[],
  actorUserId: string,
  chapterId: number,
): Promise<AssignLinksToChannelResult> {
  const ids = [...new Set(linkIds)];
  if (ids.length === 0) return { assignedIds: [], rejectedIds: [] };
  const statements = ids.map((linkId) =>
    db
      .prepare(
        `UPDATE links SET campaign_channel_id = NULL, updated_at = unixepoch()
         WHERE id = ? AND deleted_at IS NULL AND campaign_channel_id IS NOT NULL
           AND (owner_user_id = ? OR owner_chapter_id = ?)`,
      )
      .bind(linkId, actorUserId, chapterId),
  );
  const results = await db.batch(statements);
  const assignedIds = ids.filter((_, index) => (results[index]?.meta.changes ?? 0) > 0);
  const assignedSet = new Set(assignedIds);
  return { assignedIds, rejectedIds: ids.filter((id) => !assignedSet.has(id)) };
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE") || message.includes("unique constraint");
}

// ---------- Tags ----------

export type Tag = {
  id: number;
  name: string;
  color: string | null;
  ownerUserId: string | null;
  ownerChapterId: number | null;
  createdAt: number;
};

type TagRow = {
  id: number;
  name: string;
  color: string | null;
  owner_user_id: string | null;
  owner_chapter_id: number | null;
  created_at: number;
};

export function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    ownerUserId: row.owner_user_id,
    ownerChapterId: row.owner_chapter_id,
    createdAt: row.created_at,
  };
}

const TAG_COLS = "id, name, color, owner_user_id, owner_chapter_id, created_at";

export async function listTagsForUser(db: D1Database, userId: string): Promise<Tag[]> {
  const { results } = await db
    .prepare(`SELECT ${TAG_COLS} FROM tags WHERE owner_user_id = ? ORDER BY name`)
    .bind(userId)
    .all<TagRow>();
  return results.map(toTag);
}

export async function listTagsForChapter(db: D1Database, chapterId: number): Promise<Tag[]> {
  const { results } = await db
    .prepare(`SELECT ${TAG_COLS} FROM tags WHERE owner_chapter_id = ? ORDER BY name`)
    .bind(chapterId)
    .all<TagRow>();
  return results.map(toTag);
}

export async function listTagsForLink(db: D1Database, linkId: string): Promise<Tag[]> {
  const cols = TAG_COLS.split(", ")
    .map((c) => `t.${c}`)
    .join(", ");
  const { results } = await db
    .prepare(
      `SELECT ${cols}
       FROM tags t
       JOIN link_tags lt ON lt.tag_id = t.id
       WHERE lt.link_id = ?
       ORDER BY t.name`,
    )
    .bind(linkId)
    .all<TagRow>();
  return results.map(toTag);
}

export type CreateTagInput = {
  name: string;
  color?: string | null;
  ownerUserId?: string | null;
  ownerChapterId?: number | null;
};

export type CreateTagResult = { ok: true; tag: Tag } | { ok: false; reason: "duplicate" };

export async function createTag(db: D1Database, input: CreateTagInput): Promise<CreateTagResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO tags (name, color, owner_user_id, owner_chapter_id)
         VALUES (?, ?, ?, ?)
         RETURNING ${TAG_COLS}`,
      )
      .bind(
        input.name,
        input.color ?? null,
        input.ownerUserId ?? null,
        input.ownerChapterId ?? null,
      )
      .first<TagRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, tag: toTag(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("CONSTRAINT")) {
      return { ok: false, reason: "duplicate" };
    }
    throw err;
  }
}

export async function deleteTag(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM tags WHERE id = ?").bind(id).run();
}

export type UpdateTagInput = {
  id: number;
  name: string;
  color?: string | null;
};

export type UpdateTagResult = { ok: true; tag: Tag } | { ok: false; reason: "duplicate" };

export async function updateTag(db: D1Database, input: UpdateTagInput): Promise<UpdateTagResult> {
  try {
    const row = await db
      .prepare(
        `UPDATE tags SET name = ?, color = ? WHERE id = ?
         RETURNING ${TAG_COLS}`,
      )
      .bind(input.name, input.color ?? null, input.id)
      .first<TagRow>();
    if (!row) throw new Error("Update returned no row");
    return { ok: true, tag: toTag(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("CONSTRAINT")) {
      return { ok: false, reason: "duplicate" };
    }
    throw err;
  }
}

export type TagWithCount = Tag & { linkCount: number };

type TagWithCountRow = TagRow & { link_count: number };

const TAG_WITH_COUNT_SELECT = `
  SELECT ${TAG_COLS.split(", ")
    .map((c) => `t.${c}`)
    .join(", ")},
    (SELECT COUNT(*) FROM link_tags lt
       JOIN links l ON l.id = lt.link_id
      WHERE lt.tag_id = t.id AND l.deleted_at IS NULL) AS link_count
  FROM tags t
`;

function toTagWithCount(row: TagWithCountRow): TagWithCount {
  return { ...toTag(row), linkCount: row.link_count };
}

export async function listTagsForUserWithCounts(
  db: D1Database,
  userId: string,
): Promise<TagWithCount[]> {
  const { results } = await db
    .prepare(`${TAG_WITH_COUNT_SELECT} WHERE t.owner_user_id = ? ORDER BY t.name`)
    .bind(userId)
    .all<TagWithCountRow>();
  return results.map(toTagWithCount);
}

export async function listTagsForChapterWithCounts(
  db: D1Database,
  chapterId: number,
): Promise<TagWithCount[]> {
  const { results } = await db
    .prepare(`${TAG_WITH_COUNT_SELECT} WHERE t.owner_chapter_id = ? ORDER BY t.name`)
    .bind(chapterId)
    .all<TagWithCountRow>();
  return results.map(toTagWithCount);
}

export async function setLinkTags(db: D1Database, linkId: string, tagIds: number[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM link_tags WHERE link_id = ?").bind(linkId),
  ];
  for (const tagId of tagIds) {
    stmts.push(
      db
        .prepare("INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)")
        .bind(linkId, tagId),
    );
  }
  await db.batch(stmts);
}

// ---------- Comments ----------

export type Comment = {
  id: number;
  linkId: string;
  authorUserId: string;
  body: string;
  createdAt: number;
};

type CommentRow = {
  id: number;
  link_id: string;
  author_user_id: string;
  body: string;
  created_at: number;
};

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    linkId: row.link_id,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

const COMMENT_COLS = "id, link_id, author_user_id, body, created_at";

export async function listComments(db: D1Database, linkId: string): Promise<Comment[]> {
  const { results } = await db
    .prepare(`SELECT ${COMMENT_COLS} FROM comments WHERE link_id = ? ORDER BY created_at`)
    .bind(linkId)
    .all<CommentRow>();
  return results.map(toComment);
}

export async function addComment(
  db: D1Database,
  input: { linkId: string; authorUserId: string; body: string },
): Promise<Comment> {
  const row = await db
    .prepare(
      `INSERT INTO comments (link_id, author_user_id, body)
       VALUES (?, ?, ?)
       RETURNING ${COMMENT_COLS}`,
    )
    .bind(input.linkId, input.authorUserId, input.body)
    .first<CommentRow>();
  if (!row) throw new Error("Insert returned no row");
  return toComment(row);
}

export async function deleteComment(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
}

// ---------- Permissions ----------

export type LinkRole = "editor" | "viewer";
export type PrincipalType = "user" | "chapter";

export type LinkPermission = {
  id: number;
  linkId: string;
  principalType: PrincipalType;
  principalId: string;
  role: LinkRole;
  createdAt: number;
};

type LinkPermissionRow = {
  id: number;
  link_id: string;
  principal_type: PrincipalType;
  principal_id: string;
  role: LinkRole;
  created_at: number;
};

export function toLinkPermission(row: LinkPermissionRow): LinkPermission {
  return {
    id: row.id,
    linkId: row.link_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    role: row.role,
    createdAt: row.created_at,
  };
}

const PERM_COLS = "id, link_id, principal_type, principal_id, role, created_at";

export async function listPermissionsForLink(
  db: D1Database,
  linkId: string,
): Promise<LinkPermission[]> {
  const { results } = await db
    .prepare(`SELECT ${PERM_COLS} FROM link_permissions WHERE link_id = ? ORDER BY created_at`)
    .bind(linkId)
    .all<LinkPermissionRow>();
  return results.map(toLinkPermission);
}

export async function listLinksAccessibleByEmail(
  db: D1Database,
  email: string,
  chapterId: number | null,
): Promise<Link[]> {
  const linkCols = LINK_COLS.split(", ")
    .map((c) => `l.${c}`)
    .join(", ");
  if (chapterId == null) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT ${linkCols}
         FROM links l
         JOIN link_permissions p ON p.link_id = l.id
         WHERE l.deleted_at IS NULL
           AND p.principal_type = 'user' AND p.principal_id = ?
         ORDER BY l.created_at DESC`,
      )
      .bind(email)
      .all<LinkRow>();
    return results.map(toLink);
  }
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ${linkCols}
       FROM links l
       JOIN link_permissions p ON p.link_id = l.id
       WHERE l.deleted_at IS NULL
         AND (
           (p.principal_type = 'user' AND p.principal_id = ?)
           OR (p.principal_type = 'chapter' AND p.principal_id = ?)
         )
       ORDER BY l.created_at DESC`,
    )
    .bind(email, String(chapterId))
    .all<LinkRow>();
  return results.map(toLink);
}

export type AddPermissionInput = {
  linkId: string;
  principalType: PrincipalType;
  principalId: string;
  role: LinkRole;
};

export type AddPermissionResult =
  | { ok: true; permission: LinkPermission }
  | { ok: false; reason: "duplicate" };

export async function addPermission(
  db: D1Database,
  input: AddPermissionInput,
): Promise<AddPermissionResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO link_permissions (link_id, principal_type, principal_id, role)
         VALUES (?, ?, ?, ?)
         RETURNING ${PERM_COLS}`,
      )
      .bind(input.linkId, input.principalType, input.principalId, input.role)
      .first<LinkPermissionRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, permission: toLinkPermission(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("CONSTRAINT")) {
      return { ok: false, reason: "duplicate" };
    }
    throw err;
  }
}

export async function removePermission(
  db: D1Database,
  linkId: string,
  id: number,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM link_permissions WHERE id = ? AND link_id = ?")
    .bind(id, linkId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function updatePermissionRole(
  db: D1Database,
  linkId: string,
  id: number,
  role: LinkRole,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE link_permissions SET role = ? WHERE id = ? AND link_id = ?")
    .bind(role, id, linkId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export type UserSummary = { id: string; email: string; name: string; image: string | null };

export async function getUsersByIds(
  db: D1Database,
  ids: string[],
): Promise<Record<string, UserSummary>> {
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT id, email, name, image FROM "user" WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<UserSummary>();
  const out: Record<string, UserSummary> = {};
  for (const u of results) out[u.id] = u;
  return out;
}
