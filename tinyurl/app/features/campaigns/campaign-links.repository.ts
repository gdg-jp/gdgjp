import type { Link } from "~/features/links/link-record";
import type { LinkRow } from "~/features/links/link-record";
import { toLink } from "~/features/links/link-record";
import { linkColumns } from "~/features/links/link-record";
import { LINK_COLS } from "~/features/links/link-record";
import type { Comment } from "~/features/links/link-record";
import type { CommentRow } from "~/features/links/link-record";
import { toComment } from "~/features/links/link-record";

export async function listLinksForCampaignChannel(
  db: D1Database,
  channelId: number,
): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links
       WHERE campaign_channel_id = ? AND archived_at IS NULL AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .bind(channelId)
    .all<LinkRow>();
  return results.map(toLink);
}

export async function listLinksForCampaign(db: D1Database, campaignId: number): Promise<Link[]> {
  const linkCols = linkColumns("l");
  const { results } = await db
    .prepare(
      `SELECT ${linkCols} FROM links l
       JOIN campaign_channels m ON m.id = l.campaign_channel_id
       WHERE m.campaign_id = ? AND l.archived_at IS NULL AND l.deleted_at IS NULL
       ORDER BY m.sort_order, l.created_at DESC`,
    )
    .bind(campaignId)
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
       WHERE archived_at IS NULL AND deleted_at IS NULL
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
         WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL
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
         WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL
           AND campaign_channel_id IS NOT NULL
           AND (owner_user_id = ? OR owner_chapter_id = ?)`,
      )
      .bind(linkId, actorUserId, chapterId),
  );
  const results = await db.batch(statements);
  const assignedIds = ids.filter((_, index) => (results[index]?.meta.changes ?? 0) > 0);
  const assignedSet = new Set(assignedIds);
  return { assignedIds, rejectedIds: ids.filter((id) => !assignedSet.has(id)) };
}

export async function listLatestCommentsForCampaign(
  db: D1Database,
  campaignId: number,
): Promise<Record<string, Comment>> {
  const { results } = await db
    .prepare(
      `SELECT id, link_id, author_user_id, body, created_at
       FROM (
         SELECT c.id, c.link_id, c.author_user_id, c.body, c.created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY c.link_id ORDER BY c.created_at DESC, c.id DESC
                ) AS row_number
         FROM comments c
         JOIN links l ON l.id = c.link_id
         JOIN campaign_channels channel ON channel.id = l.campaign_channel_id
         WHERE channel.campaign_id = ? AND l.archived_at IS NULL AND l.deleted_at IS NULL
       )
       WHERE row_number = 1`,
    )
    .bind(campaignId)
    .all<CommentRow>();
  const comments: Record<string, Comment> = {};
  for (const row of results) comments[row.link_id] = toComment(row);
  return comments;
}
