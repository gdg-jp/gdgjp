/**
 * Validation for an event-owned role's name (ADR-011). Pure so the route
 * action and its tests share one rule set. Names are compared after NFKC +
 * lowercase so "ＴＡ" and "ta" — or a custom "受付" next to the seeded one —
 * can't produce two indistinguishable columns in the demand matrix.
 */

export const ROLE_NAME_MAX_LENGTH = 30;
export const CUSTOM_ROLE_LIMIT = 20;

type NamedRole = { id: string; name: string; custom: boolean };

export type RoleNameResult = { ok: true; name: string } | { ok: false; error: string };

function comparableName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

/** `selfId` excludes the role being renamed from the duplicate check. */
export function validateRoleName(
  raw: string,
  roles: readonly NamedRole[],
  selfId?: string,
): RoleNameResult {
  const name = raw.trim();
  if (!name) return { ok: false, error: "役割名を入力してください。" };
  if (name.length > ROLE_NAME_MAX_LENGTH) {
    return { ok: false, error: `役割名は${ROLE_NAME_MAX_LENGTH}文字以内で入力してください。` };
  }
  const key = comparableName(name);
  if (roles.some((role) => role.id !== selfId && comparableName(role.name) === key)) {
    return { ok: false, error: `「${name}」という役割はすでにあります。` };
  }
  return { ok: true, name };
}

export function canCreateCustomRole(roles: readonly NamedRole[]): boolean {
  return roles.filter((role) => role.custom).length < CUSTOM_ROLE_LIMIT;
}
