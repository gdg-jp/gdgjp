import type { LinkRole } from "~/features/links/link-record";
import type { PrincipalType } from "~/features/links/link-record";
import type { LinkPermission } from "~/features/links/link-record";
import type { LinkPermissionRow } from "~/features/links/link-record";
import { toLinkPermission } from "~/features/links/link-record";
import { PERM_COLS } from "~/features/links/link-record";

// ---------- Permissions ----------

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

export async function copyFolderPermissionsToLink(
  db: D1Database,
  folderId: number,
  linkId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO link_permissions (link_id, principal_type, principal_id, role)
       SELECT ?, principal_type, principal_id, role FROM folder_permissions WHERE folder_id = ?
       ON CONFLICT(link_id, principal_type, principal_id) DO NOTHING`,
    )
    .bind(linkId, folderId)
    .run();
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

/**
 * Replaces every explicit permission on a link in one D1 batch. Callers must
 * validate the requested principals before invoking this function.
 */
export async function replaceLinkPermissions(
  db: D1Database,
  linkId: string,
  permissions: Array<{
    principalType: PrincipalType;
    principalId: string;
    role: LinkRole;
  }>,
): Promise<void> {
  const statements = [
    db.prepare("DELETE FROM link_permissions WHERE link_id = ?").bind(linkId),
    ...permissions.map((permission) =>
      db
        .prepare(
          `INSERT INTO link_permissions (link_id, principal_type, principal_id, role)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(linkId, permission.principalType, permission.principalId, permission.role),
    ),
  ];
  await db.batch(statements);
}
