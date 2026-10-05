import { getFolderById } from "~/features/folders/folder-access.repository";
import { canEditFolder } from "~/features/folders/folder-access.repository";
import type { Folder } from "~/features/folders/folder-record";
import type { FolderRow } from "~/features/folders/folder-record";
import { FOLDER_COLS } from "~/features/folders/folder-record";
import { toFolder } from "~/features/folders/folder-record";
import type { FolderViewer } from "~/features/folders/folder-record";
import type { FolderPermission } from "~/features/folders/folder-record";
import type { FolderPermissionRow } from "~/features/folders/folder-record";
import { FOLDER_PERMISSION_COLS } from "~/features/folders/folder-record";
import { toFolderPermission } from "~/features/folders/folder-record";
import type { LinkRole } from "~/features/links/link-record";
import type { PrincipalType } from "~/features/links/link-record";

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE") || message.includes("unique constraint");
}

export type CreateFolderInput = {
  name: string;
  actor: FolderViewer;
  parentFolderId?: number | null;
};

export type FolderMutationResult =
  | { ok: true; folder: Folder }
  | { ok: false; reason: "duplicate" | "forbidden" | "not_found" };

export async function createFolder(
  db: D1Database,
  input: CreateFolderInput,
): Promise<FolderMutationResult> {
  let ownerUserId = input.actor.userId;
  const parentFolderId = input.parentFolderId ?? null;
  if (parentFolderId !== null) {
    const parent = await getFolderById(db, parentFolderId);
    if (!parent) return { ok: false, reason: "not_found" };
    if (!(await canEditFolder(db, parentFolderId, input.actor))) {
      return { ok: false, reason: "forbidden" };
    }
    ownerUserId = parent.ownerUserId;
  }
  try {
    const row = await db
      .prepare(
        `INSERT INTO folders (name, owner_user_id, parent_folder_id)
         VALUES (?, ?, ?) RETURNING ${FOLDER_COLS}`,
      )
      .bind(input.name, ownerUserId, parentFolderId)
      .first<FolderRow>();
    if (!row) throw new Error("Insert returned no row");
    if (parentFolderId !== null) await copyFolderPermissions(db, parentFolderId, row.id);
    return { ok: true, folder: toFolder(row) };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

export async function updateFolder(
  db: D1Database,
  input: { id: number; name: string; actor: FolderViewer },
): Promise<FolderMutationResult> {
  if (!(await canEditFolder(db, input.id, input.actor))) return { ok: false, reason: "forbidden" };
  try {
    const row = await db
      .prepare(
        `UPDATE folders SET name = ?, updated_at = unixepoch()
         WHERE id = ? RETURNING ${FOLDER_COLS}`,
      )
      .bind(input.name, input.id)
      .first<FolderRow>();
    return row ? { ok: true, folder: toFolder(row) } : { ok: false, reason: "not_found" };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "duplicate" };
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

export type FolderPermissionMutationResult =
  | { ok: true; permission: FolderPermission }
  | { ok: false; reason: "duplicate" | "forbidden" | "not_found" };

export async function listFolderPermissions(
  db: D1Database,
  folderId: number,
): Promise<FolderPermission[]> {
  const { results } = await db
    .prepare(
      `SELECT ${FOLDER_PERMISSION_COLS} FROM folder_permissions
       WHERE folder_id = ? ORDER BY created_at, id`,
    )
    .bind(folderId)
    .all<FolderPermissionRow>();
  return results.map(toFolderPermission);
}

export async function addFolderPermission(
  db: D1Database,
  input: FolderViewer & {
    folderId: number;
    principalType: PrincipalType;
    principalId: string;
    role: LinkRole;
  },
): Promise<FolderPermissionMutationResult> {
  if (!(await canEditFolder(db, input.folderId, input))) return { ok: false, reason: "forbidden" };
  try {
    const row = await db
      .prepare(
        `INSERT INTO folder_permissions (folder_id, principal_type, principal_id, role)
         VALUES (?, ?, ?, ?) RETURNING ${FOLDER_PERMISSION_COLS}`,
      )
      .bind(input.folderId, input.principalType, input.principalId, input.role)
      .first<FolderPermissionRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, permission: toFolderPermission(row) };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

export async function removeFolderPermission(
  db: D1Database,
  input: FolderViewer & { folderId: number; id: number },
): Promise<boolean> {
  if (!(await canEditFolder(db, input.folderId, input))) return false;
  const result = await db
    .prepare("DELETE FROM folder_permissions WHERE id = ? AND folder_id = ?")
    .bind(input.id, input.folderId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function updateFolderPermissionRole(
  db: D1Database,
  input: FolderViewer & { folderId: number; id: number; role: LinkRole },
): Promise<boolean> {
  if (!(await canEditFolder(db, input.folderId, input))) return false;
  const result = await db
    .prepare("UPDATE folder_permissions SET role = ? WHERE id = ? AND folder_id = ?")
    .bind(input.role, input.id, input.folderId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function copyFolderPermissions(
  db: D1Database,
  sourceFolderId: number,
  destinationFolderId: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO folder_permissions (folder_id, principal_type, principal_id, role)
       SELECT ?, principal_type, principal_id, role FROM folder_permissions WHERE folder_id = ?
       ON CONFLICT(folder_id, principal_type, principal_id) DO NOTHING`,
    )
    .bind(destinationFolderId, sourceFolderId)
    .run();
}
