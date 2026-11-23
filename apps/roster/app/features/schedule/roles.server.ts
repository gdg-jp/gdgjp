import { resolveRosterSheetId } from "./tracks.server";

export type Role = { id: string; name: string; sortOrder: number; custom: boolean };

type RoleRow = { id: string; name: string; sort_order: number; event_id: string | null };

const ROLE_COLS = "id, name, sort_order, event_id";

export function toRole(r: RoleRow): Role {
  return { id: r.id, name: r.name, sortOrder: r.sort_order, custom: r.event_id !== null };
}

export async function listRoles(db: D1Database, eventId: string): Promise<Role[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ROLE_COLS} FROM roles
       WHERE event_id IS NULL OR event_id = ?
       ORDER BY sort_order, id`,
    )
    .bind(eventId)
    .all<RoleRow>();
  return (results ?? []).map(toRole);
}

export async function listEventRoleIds(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<string[]> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, false);
  if (!sheetId) return [];
  const { results } = await db
    .prepare("SELECT role_id FROM roster_sheet_roles WHERE roster_sheet_id = ? ORDER BY role_id")
    .bind(sheetId)
    .all<{ role_id: string }>();
  return (results ?? []).map((r) => r.role_id);
}

export async function setEventRoles(
  db: D1Database,
  eventId: string,
  roleIds: readonly string[],
  rosterSheetId?: string,
): Promise<void> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM roster_sheet_roles WHERE roster_sheet_id = ?").bind(sheetId),
  ];
  for (const roleId of roleIds) {
    statements.push(
      db
        .prepare("INSERT INTO roster_sheet_roles (roster_sheet_id, role_id) VALUES (?, ?)")
        .bind(sheetId, roleId),
    );
  }
  await db.batch(statements);
}

export async function createEventRole(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
  name: string,
): Promise<Role> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO roles (id, name, sort_order, event_id)
         SELECT ?, ?, COALESCE(MAX(sort_order), 0) + 1, ?
         FROM roles WHERE event_id IS NULL OR event_id = ?`,
      )
      .bind(id, name, eventId, eventId),
    db
      .prepare("INSERT INTO roster_sheet_roles (roster_sheet_id, role_id) VALUES (?, ?)")
      .bind(sheetId, id),
  ]);
  const row = await db
    .prepare(`SELECT ${ROLE_COLS} FROM roles WHERE id = ?`)
    .bind(id)
    .first<RoleRow>();
  if (!row) throw new Error("Role insert returned no row");
  return toRole(row);
}

export async function renameEventRole(
  db: D1Database,
  eventId: string,
  roleId: string,
  name: string,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE roles SET name = ? WHERE id = ? AND event_id = ?")
    .bind(name, roleId, eventId)
    .run();
  return result.meta.changes > 0;
}

export type DeleteEventRoleResult = "deleted" | "in-use" | "not-found";

const DELETABLE_GUARD = `EXISTS (SELECT 1 FROM roles WHERE id = ? AND event_id = ?)
  AND NOT EXISTS (
    SELECT 1 FROM demands d JOIN roster_sheets s ON s.id = d.roster_sheet_id
    WHERE d.role_id = ? AND d.event_id = ? AND d.ideal_count > 0 AND s.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM assignments a JOIN roster_sheets s ON s.id = a.roster_sheet_id
    WHERE a.role_id = ? AND a.event_id = ? AND s.deleted_at IS NULL
  )`;

export async function deleteEventRole(
  db: D1Database,
  eventId: string,
  roleId: string,
): Promise<DeleteEventRoleResult> {
  const guard = [roleId, eventId, roleId, eventId, roleId, eventId];
  const results = await db.batch([
    db
      .prepare(`DELETE FROM demands WHERE role_id = ? AND event_id = ? AND ${DELETABLE_GUARD}`)
      .bind(roleId, eventId, ...guard),
    db
      .prepare(`DELETE FROM assignments WHERE role_id = ? AND event_id = ? AND ${DELETABLE_GUARD}`)
      .bind(roleId, eventId, ...guard),
    db
      .prepare(
        `DELETE FROM application_skills
         WHERE role_id = ? AND application_id IN (SELECT id FROM applications WHERE event_id = ?)
           AND ${DELETABLE_GUARD}`,
      )
      .bind(roleId, eventId, ...guard),
    db
      .prepare(
        `DELETE FROM roster_sheet_roles
         WHERE role_id = ? AND roster_sheet_id IN (SELECT id FROM roster_sheets WHERE event_id = ?)
           AND ${DELETABLE_GUARD}`,
      )
      .bind(roleId, eventId, ...guard),
    db
      .prepare(`DELETE FROM event_roles WHERE role_id = ? AND event_id = ? AND ${DELETABLE_GUARD}`)
      .bind(roleId, eventId, ...guard),
    db
      .prepare(`DELETE FROM roles WHERE id = ? AND event_id = ? AND ${DELETABLE_GUARD}`)
      .bind(roleId, eventId, ...guard),
  ]);
  if ((results.at(-1)?.meta.changes ?? 0) > 0) return "deleted";
  const owned = await db
    .prepare("SELECT 1 AS found FROM roles WHERE id = ? AND event_id = ?")
    .bind(roleId, eventId)
    .first<{ found: number }>();
  return owned ? "in-use" : "not-found";
}
