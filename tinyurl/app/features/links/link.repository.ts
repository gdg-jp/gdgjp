import { newLinkId } from "~/features/links/id";
import type { LinkVisibility } from "~/features/links/link-record";
import type { Link } from "~/features/links/link-record";
import type { LinkRow } from "~/features/links/link-record";
import { toLink } from "~/features/links/link-record";
import { linkColumns } from "~/features/links/link-record";
import { LINK_COLS } from "~/features/links/link-record";

export async function getLinkById(db: D1Database, id: string): Promise<Link | null> {
  const row = await db
    .prepare(`SELECT ${LINK_COLS} FROM links WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export async function listVisibleLinksPage(
  db: D1Database,
  input: {
    userId: string;
    email: string;
    chapterIds: number[];
    isSuperAdmin?: boolean;
    folderId?: number;
    tagId?: number;
    limit: number;
    offset: number;
  },
): Promise<{ links: Link[]; nextCursor: string | null }> {
  const conditions = ["l.deleted_at IS NULL"];
  const values: (string | number)[] = [];
  if (!input.isSuperAdmin) {
    conditions.push(
      "(l.owner_user_id = ? OR l.owner_chapter_id IN (SELECT value FROM json_each(?)) OR l.visibility = 'public' OR EXISTS (SELECT 1 FROM link_permissions p WHERE p.link_id = l.id AND ((p.principal_type = 'user' AND p.principal_id = ?) OR (p.principal_type = 'chapter' AND p.principal_id IN (SELECT value FROM json_each(?))))))",
    );
    values.push(
      input.userId,
      JSON.stringify(input.chapterIds),
      input.email,
      JSON.stringify(input.chapterIds),
    );
  }
  if (input.folderId !== undefined) {
    conditions.push("l.folder_id = ?");
    values.push(input.folderId);
  }
  if (input.tagId !== undefined) {
    conditions.push(
      "EXISTS (SELECT 1 FROM link_tags lt WHERE lt.link_id = l.id AND lt.tag_id = ?)",
    );
    values.push(input.tagId);
  }
  const { results } = await db
    .prepare(
      `SELECT ${linkColumns("l")} FROM links l WHERE ${conditions.join(" AND ")} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values, input.limit + 1, input.offset)
    .all<LinkRow>();
  const page = results.map(toLink);
  const hasMore = page.length > input.limit;
  return {
    links: page.slice(0, input.limit),
    nextCursor: hasMore ? btoa(String(input.offset + input.limit)) : null,
  };
}

export type CreateLinkRecord = {
  domainId?: number;
  slug: string;
  destinationUrl: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  ownerUserId: string;
  ownerChapterId?: number | null;
  campaignChannelId?: number | null;
  folderId?: number | null;
  visibility?: LinkVisibility;
};

export type CreateLinkResult = { ok: true; link: Link } | { ok: false; reason: "slug_taken" };

export async function createLink(
  db: D1Database,
  input: CreateLinkRecord,
): Promise<CreateLinkResult> {
  const ownerChapterId = input.ownerChapterId ?? null;
  try {
    const row = await db
      .prepare(
        `INSERT INTO links (id, domain_id, slug, destination_url, title, description, og_image_url, owner_user_id, owner_chapter_id, campaign_channel_id, folder_id, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${LINK_COLS}`,
      )
      .bind(
        newLinkId(),
        input.domainId ?? 1,
        input.slug,
        input.destinationUrl,
        input.title ?? null,
        input.description ?? null,
        input.ogImageUrl ?? null,
        input.ownerUserId,
        ownerChapterId,
        input.campaignChannelId ?? null,
        input.folderId ?? null,
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

export type UpdateLinkRecord = {
  domainId?: number;
  slug?: string;
  destinationUrl?: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  campaignChannelId?: number | null;
  folderId?: number | null;
  visibility?: LinkVisibility;
  ownerChapterId?: number | null;
};

export async function updateLink(
  db: D1Database,
  id: string,
  input: UpdateLinkRecord,
): Promise<Link | null> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.domainId !== undefined) {
    sets.push("domain_id = ?");
    values.push(input.domainId);
  }
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
  if (input.folderId !== undefined) {
    sets.push("folder_id = ?");
    values.push(input.folderId);
  }
  if (input.visibility !== undefined) {
    sets.push("visibility = ?");
    values.push(input.visibility);
  }
  if (input.ownerChapterId !== undefined) {
    sets.push("owner_chapter_id = ?");
    values.push(input.ownerChapterId);
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

export async function archiveLink(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE links SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL",
    )
    .bind(id)
    .run();
}

export async function restoreLink(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE links SET archived_at = NULL, updated_at = unixepoch() WHERE id = ? AND archived_at IS NOT NULL AND deleted_at IS NULL",
    )
    .bind(id)
    .run();
}

export async function deleteLink(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM links WHERE id = ?").bind(id).run();
}
