export type Folder = {
  id: number;
  name: string;
  ownerUserId: string;
  parentFolderId: number | null;
  createdAt: number;
  updatedAt: number;
};
export type FolderViewer = {
  userId: string;
  email: string;
  chapterIds: number[];
  isSuperAdmin?: boolean;
};
export type FolderWithCounts = Folder & { linkCount: number; childFolderCount: number };
type FolderRow = {
  id: number;
  name: string;
  owner_user_id: string;
  parent_folder_id: number | null;
  created_at: number;
  updated_at: number;
};
const COLS = "id, name, owner_user_id, parent_folder_id, created_at, updated_at";
function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    parentFolderId: row.parent_folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function bindings(viewer: FolderViewer): [string, string, string] {
  return [viewer.userId, viewer.email, JSON.stringify(viewer.chapterIds.map(String))];
}
const ACCESS = `(f.owner_user_id = ? OR EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = f.id AND ((fp.principal_type = 'user' AND fp.principal_id = ?) OR (fp.principal_type = 'chapter' AND fp.principal_id IN (SELECT value FROM json_each(?))))))`;
const PARENT_ACCESS = `(parent.owner_user_id = ? OR EXISTS (SELECT 1 FROM folder_permissions parent_permission WHERE parent_permission.folder_id = parent.id AND ((parent_permission.principal_type = 'user' AND parent_permission.principal_id = ?) OR (parent_permission.principal_type = 'chapter' AND parent_permission.principal_id IN (SELECT value FROM json_each(?))))))`;
const CHILD_ACCESS = `(child.owner_user_id = ? OR EXISTS (SELECT 1 FROM folder_permissions child_permission WHERE child_permission.folder_id = child.id AND ((child_permission.principal_type = 'user' AND child_permission.principal_id = ?) OR (child_permission.principal_type = 'chapter' AND child_permission.principal_id IN (SELECT value FROM json_each(?))))))`;
const LINK_ACCESS = `(l.owner_user_id = ? OR l.owner_chapter_id IN (SELECT value FROM json_each(?)) OR l.visibility = 'public' OR EXISTS (SELECT 1 FROM link_permissions lp WHERE lp.link_id = l.id AND ((lp.principal_type = 'user' AND lp.principal_id = ?) OR (lp.principal_type = 'chapter' AND lp.principal_id IN (SELECT value FROM json_each(?))))))`;
function linkBindings(viewer: FolderViewer): [string, string, string, string] {
  const chapters = JSON.stringify(viewer.chapterIds.map(String));
  return [viewer.userId, chapters, viewer.email, chapters];
}

export type FolderPage = { folders: FolderWithCounts[]; nextCursor: string | null };

export async function getFolderById(db: D1Database, id: number): Promise<Folder | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM folders WHERE id = ?`)
    .bind(id)
    .first<FolderRow>();
  return row ? toFolder(row) : null;
}
export async function canViewFolder(
  db: D1Database,
  id: number,
  viewer: FolderViewer,
): Promise<boolean> {
  if (viewer.isSuperAdmin) return (await getFolderById(db, id)) !== null;
  const row = await db
    .prepare(`SELECT 1 FROM folders f WHERE f.id = ? AND ${ACCESS}`)
    .bind(id, ...bindings(viewer))
    .first();
  return row !== null;
}
export async function canEditFolder(
  db: D1Database,
  id: number,
  viewer: FolderViewer,
): Promise<boolean> {
  if (viewer.isSuperAdmin) return (await getFolderById(db, id)) !== null;
  const row = await db
    .prepare(
      `SELECT 1 FROM folders f WHERE f.id = ? AND (f.owner_user_id = ? OR EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = f.id AND fp.role = 'editor' AND ((fp.principal_type = 'user' AND fp.principal_id = ?) OR (fp.principal_type = 'chapter' AND fp.principal_id IN (SELECT value FROM json_each(?))))))`,
    )
    .bind(id, viewer.userId, viewer.email, JSON.stringify(viewer.chapterIds.map(String)))
    .first();
  return row !== null;
}
export async function createFolder(
  db: D1Database,
  input: { name: string; actor: FolderViewer; parentFolderId?: number },
): Promise<
  { ok: true; folder: Folder } | { ok: false; reason: "duplicate" | "forbidden" | "not_found" }
> {
  const parentId = input.parentFolderId;
  let owner = input.actor.userId;
  if (parentId !== undefined) {
    const parent = await getFolderById(db, parentId);
    if (!parent) return { ok: false, reason: "not_found" };
    if (!(await canEditFolder(db, parentId, input.actor)))
      return { ok: false, reason: "forbidden" };
    owner = parent.ownerUserId;
  }
  try {
    const row = await db
      .prepare(
        `INSERT INTO folders (name, owner_user_id, parent_folder_id) VALUES (?, ?, ?) RETURNING ${COLS}`,
      )
      .bind(input.name, owner, parentId ?? null)
      .first<FolderRow>();
    if (!row) throw new Error("Insert returned no row");
    if (parentId !== undefined)
      await db
        .prepare(
          "INSERT INTO folder_permissions (folder_id, principal_type, principal_id, role) SELECT ?, principal_type, principal_id, role FROM folder_permissions WHERE folder_id = ? ON CONFLICT(folder_id, principal_type, principal_id) DO NOTHING",
        )
        .bind(row.id, parentId)
        .run();
    return { ok: true, folder: toFolder(row) };
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return { ok: false, reason: "duplicate" };
    throw error;
  }
}
export async function updateFolder(
  db: D1Database,
  input: { id: number; name: string; actor: FolderViewer },
): Promise<
  { ok: true; folder: Folder } | { ok: false; reason: "duplicate" | "forbidden" | "not_found" }
> {
  if (!(await canEditFolder(db, input.id, input.actor))) return { ok: false, reason: "forbidden" };
  try {
    const row = await db
      .prepare(
        `UPDATE folders SET name = ?, updated_at = unixepoch() WHERE id = ? RETURNING ${COLS}`,
      )
      .bind(input.name, input.id)
      .first<FolderRow>();
    return row ? { ok: true, folder: toFolder(row) } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return { ok: false, reason: "duplicate" };
    throw error;
  }
}
export async function deleteFolder(
  db: D1Database,
  input: { id: number; actor: FolderViewer },
): Promise<boolean> {
  if (!(await canEditFolder(db, input.id, input.actor))) return false;
  const result = await db.prepare("DELETE FROM folders WHERE id = ?").bind(input.id).run();
  return (result.meta.changes ?? 0) > 0;
}

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
      : ` AND (f.parent_folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM folders parent WHERE parent.id = f.parent_folder_id AND ${PARENT_ACCESS}))`
    : " AND f.parent_folder_id = ?";
  const folderCols = COLS.split(", ")
    .map((column) => `f.${column}`)
    .join(", ");
  const { results } = await db
    .prepare(
      `SELECT ${folderCols}, (SELECT COUNT(*) FROM links l WHERE l.folder_id = f.id AND l.archived_at IS NULL AND l.deleted_at IS NULL${admin ? "" : ` AND ${LINK_ACCESS}`}) AS link_count, (SELECT COUNT(*) FROM folders child WHERE child.parent_folder_id = f.id${admin ? "" : ` AND ${CHILD_ACCESS}`}) AS child_folder_count FROM folders f WHERE ${admin ? "1 = 1" : ACCESS}${parentCondition} ORDER BY f.name, f.id LIMIT ? OFFSET ?`,
    )
    .bind(
      ...(admin ? [] : linkBindings(viewer)),
      ...(admin ? [] : bindings(viewer)),
      ...(admin ? [] : bindings(viewer)),
      ...(isRoot && !admin ? bindings(viewer) : []),
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
