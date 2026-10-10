import { CUSTOM_ROLE_LIMIT, canCreateCustomRole, validateRoleName } from "./role-name";
import {
  createEventRole,
  deleteEventRole,
  listRoles,
  renameEventRole,
  setEventRoles,
} from "./roles.server";

/**
 * The sheet design screen's role intents (`RolePicker`): `setRoles` toggles
 * this sheet's selection; `createRole` / `renameRole` / `deleteRole` manage
 * the event's own roles (ADR-011). Kept out of the route module so
 * `e.$id.s.$sheetId.design.tsx` stays under the 400-line cap. Every id the
 * form submits is checked against `listRoles(db, eventId)`, so another
 * event's custom role id is ignored or rejected. Errors carry
 * `section: "roles"` so the screen shows them inside the role card, next to
 * the form that was submitted, instead of in the page-top banner.
 */

export type RoleIntent = "setRoles" | "createRole" | "renameRole" | "deleteRole";
export type RoleIntentResult = { ok: true } | { error: string; section: "roles" };

const ROLE_NOT_FOUND = "役割が見つかりません。画面を更新してお試しください。";

function fail(error: string): RoleIntentResult {
  return { error, section: "roles" };
}

function duplicateName(name: string): RoleIntentResult {
  return fail(`「${name}」という役割はすでにあります。`);
}

/** A concurrent exact duplicate that passed `validateRoleName` hits `roles_event_name`. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE");
}

export async function handleRoleIntent(
  db: D1Database,
  eventId: string,
  sheetId: string,
  intent: RoleIntent,
  form: FormData,
): Promise<RoleIntentResult> {
  const roles = await listRoles(db, eventId);
  switch (intent) {
    case "setRoles": {
      const submitted = new Set(form.getAll("roleId").map(String));
      const knownIds = new Set(roles.map((r) => r.id));
      const roleIds = [...submitted].filter((id) => knownIds.has(id));
      await setEventRoles(db, eventId, roleIds, sheetId);
      return { ok: true };
    }
    case "createRole": {
      if (!canCreateCustomRole(roles)) {
        return fail(`独自の役割は${CUSTOM_ROLE_LIMIT}件まで作成できます。`);
      }
      const result = validateRoleName(String(form.get("name") ?? ""), roles);
      if (!result.ok) return fail(result.error);
      try {
        await createEventRole(db, eventId, sheetId, result.name);
      } catch (error) {
        if (isUniqueViolation(error)) return duplicateName(result.name);
        throw error;
      }
      return { ok: true };
    }
    case "renameRole": {
      const roleId = String(form.get("roleId") ?? "");
      if (!roles.some((r) => r.id === roleId && r.custom)) return fail(ROLE_NOT_FOUND);
      const result = validateRoleName(String(form.get("name") ?? ""), roles, roleId);
      if (!result.ok) return fail(result.error);
      try {
        if (!(await renameEventRole(db, eventId, roleId, result.name))) {
          return fail(ROLE_NOT_FOUND);
        }
      } catch (error) {
        if (isUniqueViolation(error)) return duplicateName(result.name);
        throw error;
      }
      return { ok: true };
    }
    case "deleteRole": {
      const outcome = await deleteEventRole(db, eventId, String(form.get("roleId") ?? ""));
      if (outcome === "in-use") {
        return fail(
          "需要または割当で使われているため削除できません。先に需要を0にし、割当を外してください。",
        );
      }
      if (outcome === "not-found") return fail(ROLE_NOT_FOUND);
      return { ok: true };
    }
  }
}
