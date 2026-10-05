import type { Folder } from "~/features/folders/folder-record";
import type { FolderRow } from "~/features/folders/folder-record";
import { FOLDER_COLS } from "~/features/folders/folder-record";
import { toFolder } from "~/features/folders/folder-record";
import type { FolderViewer } from "~/features/folders/folder-record";
import type { FolderWithCounts } from "~/features/folders/folder-record";
import type { Link } from "~/features/links/link-record";
import type { LinkRow } from "~/features/links/link-record";
import { toLink } from "~/features/links/link-record";
import { linkColumns } from "~/features/links/link-record";
import type { LinkRole } from "~/features/links/link-record";

const FOLDER_ACCESS_SQL = `(
  f.owner_user_id = ?
  OR EXISTS (
    SELECT 1 FROM folder_permissions fp
    WHERE fp.folder_id = f.id AND (
      (fp.principal_type = 'user' AND fp.principal_id = ?)
      OR (fp.principal_type = 'chapter' AND fp.principal_id IN (SELECT value FROM json_each(?)))
    )
  )
)`;

const PARENT_FOLDER_ACCESS_SQL = `(
  parent.owner_user_id = ?
  OR EXISTS (
    SELECT 1 FROM folder_permissions parent_permission
    WHERE parent_permission.folder_id = parent.id AND (
      (parent_permission.principal_type = 'user' AND parent_permission.principal_id = ?)
      OR (parent_permission.principal_type = 'chapter' AND parent_permission.principal_id IN (SELECT value FROM json_each(?)))
    )
  )
)`;

const CHILD_FOLDER_ACCESS_SQL = `(
  child.owner_user_id = ?
  OR EXISTS (
    SELECT 1 FROM folder_permissions child_permission
    WHERE child_permission.folder_id = child.id AND (
      (child_permission.principal_type = 'user' AND child_permission.principal_id = ?)
      OR (child_permission.principal_type = 'chapter' AND child_permission.principal_id IN (SELECT value FROM json_each(?)))
    )
  )
)`;

const LINK_ACCESS_SQL = `(
  l.owner_user_id = ?
  OR l.owner_chapter_id IN (SELECT value FROM json_each(?))
  OR l.visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM link_permissions lp
    WHERE lp.link_id = l.id AND (
      (lp.principal_type = 'user' AND lp.principal_id = ?)
      OR (lp.principal_type = 'chapter' AND lp.principal_id IN (SELECT value FROM json_each(?)))
    )
  )
)`;

function folderAccessBindings(viewer: FolderViewer): [string, string, string] {
  return [viewer.userId, viewer.email, JSON.stringify(viewer.chapterIds.map(String))];
}

function linkAccessBindings(viewer: FolderViewer): [string, string, string, string] {
  const chapterIds = JSON.stringify(viewer.chapterIds.map(String));
  return [viewer.userId, chapterIds, viewer.email, chapterIds];
}

export async function getFolderById(db: D1Database, id: number): Promise<Folder | null> {
  const row = await db
    .prepare(`SELECT ${FOLDER_COLS} FROM folders WHERE id = ?`)
    .bind(id)
    .first<FolderRow>();
  return row ? toFolder(row) : null;
}

export async function getAccessibleFolder(
  db: D1Database,
  id: number,
  viewer: FolderViewer,
): Promise<Folder | null> {
  if (viewer.isSuperAdmin) return getFolderById(db, id);
  const row = await db
    .prepare(`SELECT ${FOLDER_COLS} FROM folders f WHERE f.id = ? AND ${FOLDER_ACCESS_SQL}`)
    .bind(id, ...folderAccessBindings(viewer))
    .first<FolderRow>();
  return row ? toFolder(row) : null;
}

export async function getFolderAccessRole(
  db: D1Database,
  id: number,
  viewer: FolderViewer,
): Promise<LinkRole | null> {
  if (viewer.isSuperAdmin) return (await getFolderById(db, id)) ? "editor" : null;
  const row = await db
    .prepare(
      `SELECT CASE
        WHEN f.owner_user_id = ? THEN 'editor'
        WHEN EXISTS (
          SELECT 1 FROM folder_permissions fp
          WHERE fp.folder_id = f.id AND fp.role = 'editor' AND (
            (fp.principal_type = 'user' AND fp.principal_id = ?)
            OR (fp.principal_type = 'chapter' AND fp.principal_id IN (SELECT value FROM json_each(?)))
          )
        ) THEN 'editor'
        WHEN EXISTS (
          SELECT 1 FROM folder_permissions fp
          WHERE fp.folder_id = f.id AND (
            (fp.principal_type = 'user' AND fp.principal_id = ?)
            OR (fp.principal_type = 'chapter' AND fp.principal_id IN (SELECT value FROM json_each(?)))
          )
        ) THEN 'viewer'
        ELSE NULL
      END AS role
      FROM folders f WHERE f.id = ?`,
    )
    .bind(
      viewer.userId,
      viewer.email,
      JSON.stringify(viewer.chapterIds.map(String)),
      viewer.email,
      JSON.stringify(viewer.chapterIds.map(String)),
      id,
    )
    .first<{ role: LinkRole | null }>();
  return row?.role ?? null;
}

export async function canViewFolder(
  db: D1Database,
  id: number,
  viewer: FolderViewer,
): Promise<boolean> {
  return (await getFolderAccessRole(db, id, viewer)) !== null;
}

export async function canEditFolder(
  db: D1Database,
  id: number,
  viewer: FolderViewer,
): Promise<boolean> {
  return (await getFolderAccessRole(db, id, viewer)) === "editor";
}

export const canUserEditFolder = canEditFolder;

async function listAccessibleFoldersWithCounts(
  db: D1Database,
  viewer: FolderViewer,
  parentFolderId: number | null | undefined,
): Promise<FolderWithCounts[]> {
  const isSuperAdmin = viewer.isSuperAdmin === true;
  const parentCondition =
    parentFolderId === undefined
      ? ""
      : parentFolderId === null
        ? isSuperAdmin
          ? " AND f.parent_folder_id IS NULL"
          : ` AND (
            f.parent_folder_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM folders parent
              WHERE parent.id = f.parent_folder_id AND ${PARENT_FOLDER_ACCESS_SQL}
            )
          )`
        : " AND f.parent_folder_id = ?";
  const folderCols = FOLDER_COLS.split(", ")
    .map((column) => `f.${column}`)
    .join(", ");
  const linkCountAccess = isSuperAdmin ? "" : ` AND ${LINK_ACCESS_SQL}`;
  const childFolderCountAccess = isSuperAdmin ? "" : ` AND ${CHILD_FOLDER_ACCESS_SQL}`;
  const folderAccess = isSuperAdmin ? "1 = 1" : FOLDER_ACCESS_SQL;
  const { results } = await db
    .prepare(
      `SELECT ${folderCols},
        (SELECT COUNT(*) FROM links l
          WHERE l.folder_id = f.id AND l.archived_at IS NULL AND l.deleted_at IS NULL
            ${linkCountAccess}) AS link_count,
        (SELECT COUNT(*) FROM folders child
          WHERE child.parent_folder_id = f.id${childFolderCountAccess}) AS child_folder_count
       FROM folders f
       WHERE ${folderAccess}${parentCondition}
       ORDER BY f.name, f.id`,
    )
    .bind(
      ...(isSuperAdmin ? [] : linkAccessBindings(viewer)),
      ...(isSuperAdmin ? [] : folderAccessBindings(viewer)),
      ...(isSuperAdmin ? [] : folderAccessBindings(viewer)),
      ...(parentFolderId === null && !isSuperAdmin ? folderAccessBindings(viewer) : []),
      ...(parentFolderId === null || parentFolderId === undefined ? [] : [parentFolderId]),
    )
    .all<FolderRow & { link_count: number; child_folder_count: number }>();
  return results.map((row) => ({
    ...toFolder(row),
    linkCount: row.link_count,
    childFolderCount: row.child_folder_count,
  }));
}

export async function listAccessibleRootFoldersWithCounts(
  db: D1Database,
  viewer: FolderViewer,
): Promise<FolderWithCounts[]> {
  return listAccessibleFoldersWithCounts(db, viewer, null);
}

export async function listAccessibleChildFoldersWithCounts(
  db: D1Database,
  parentFolderId: number,
  viewer: FolderViewer,
): Promise<FolderWithCounts[]> {
  return listAccessibleFoldersWithCounts(db, viewer, parentFolderId);
}

export async function listAllAccessibleFolders(
  db: D1Database,
  viewer: FolderViewer,
): Promise<Folder[]> {
  if (viewer.isSuperAdmin) {
    const { results } = await db
      .prepare(`SELECT ${FOLDER_COLS} FROM folders ORDER BY name, id`)
      .all<FolderRow>();
    return results.map(toFolder);
  }
  const { results } = await db
    .prepare(
      `SELECT ${FOLDER_COLS} FROM folders f WHERE ${FOLDER_ACCESS_SQL} ORDER BY f.name, f.id`,
    )
    .bind(...folderAccessBindings(viewer))
    .all<FolderRow>();
  return results.map(toFolder);
}

export async function listLinksInFolderAccessible(
  db: D1Database,
  input: FolderViewer & { folderId: number; includeArchived?: boolean },
): Promise<Link[]> {
  const linkAccess = input.isSuperAdmin ? "1 = 1" : LINK_ACCESS_SQL;
  const { results } = await db
    .prepare(
      `SELECT ${linkColumns("l")} FROM links l
       WHERE l.folder_id = ? AND l.deleted_at IS NULL AND (? = 1 OR l.archived_at IS NULL)
         AND ${linkAccess}
       ORDER BY l.created_at DESC`,
    )
    .bind(
      input.folderId,
      input.includeArchived ? 1 : 0,
      ...(input.isSuperAdmin ? [] : linkAccessBindings(input)),
    )
    .all<LinkRow>();
  return results.map(toLink);
}

// Compatibility for existing callers while they move to FolderViewer-based access checks.
export async function isFolderAvailableForLinkOwner(
  db: D1Database,
  input: { id: number; ownerUserId: string; ownerChapterId: number | null },
): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM folders WHERE id = ? AND owner_user_id = ?")
    .bind(input.id, input.ownerUserId)
    .first<{ id: number }>();
  return row !== null;
}

export type FolderPage = { folders: FolderWithCounts[]; nextCursor: string | null };

/**
 * Cursor pagination lives at the feature boundary so both transport adapters
 * share one bounded-list contract. Folder rows are stable-name ordered by the
 * underlying access repository.
 */
export async function listAccessibleFoldersPage(
  db: D1Database,
  viewer: FolderViewer,
  input: { parentFolderId?: number; limit: number; offset: number },
): Promise<FolderPage> {
  const admin = viewer.isSuperAdmin === true;
  const isRoot = input.parentFolderId === undefined;
  const parentCondition = isRoot
    ? admin
      ? " AND f.parent_folder_id IS NULL"
      : ` AND (f.parent_folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM folders parent WHERE parent.id = f.parent_folder_id AND ${PARENT_FOLDER_ACCESS_SQL}))`
    : " AND f.parent_folder_id = ?";
  const folderCols = FOLDER_COLS.split(", ")
    .map((column) => `f.${column}`)
    .join(", ");
  const { results } = await db
    .prepare(
      `SELECT ${folderCols}, (SELECT COUNT(*) FROM links l WHERE l.folder_id = f.id AND l.archived_at IS NULL AND l.deleted_at IS NULL${admin ? "" : ` AND ${LINK_ACCESS_SQL}`}) AS link_count, (SELECT COUNT(*) FROM folders child WHERE child.parent_folder_id = f.id${admin ? "" : ` AND ${CHILD_FOLDER_ACCESS_SQL}`}) AS child_folder_count FROM folders f WHERE ${admin ? "1 = 1" : FOLDER_ACCESS_SQL}${parentCondition} ORDER BY f.name, f.id LIMIT ? OFFSET ?`,
    )
    .bind(
      ...(admin ? [] : linkAccessBindings(viewer)),
      ...(admin ? [] : folderAccessBindings(viewer)),
      ...(admin ? [] : folderAccessBindings(viewer)),
      ...(isRoot && !admin ? folderAccessBindings(viewer) : []),
      ...(isRoot ? [] : [input.parentFolderId]),
      input.limit + 1,
      input.offset,
    )
    .all<FolderRow & { link_count: number; child_folder_count: number }>();
  const rows = results.map((row) => ({
    ...toFolder(row),
    linkCount: row.link_count,
    childFolderCount: row.child_folder_count,
  }));
  const folders = rows.slice(0, input.limit);
  return {
    folders,
    nextCursor: rows.length > input.limit ? btoa(String(input.offset + input.limit)) : null,
  };
}
