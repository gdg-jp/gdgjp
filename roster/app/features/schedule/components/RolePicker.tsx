import { Form } from "react-router";
import type { Role } from "~/features/schedule/tracks.server";

/**
 * The "使う役割の選択" card on `/e/:id/design`
 * (docs/roster/index.md §3 "役割マスタ"). Roles themselves are the 6
 * system-seeded rows (ADR-007) — this only toggles `event_roles`
 * membership. No custom-role input exists here on purpose (Non-Goal).
 */
export function RolePicker({
  roles,
  selectedRoleIds,
  sheetId,
}: { roles: Role[]; selectedRoleIds: string[]; sheetId: string }) {
  const selected = new Set(selectedRoleIds);

  return (
    <Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="setRoles" />
      <input type="hidden" name="sheetId" value={sheetId} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {roles.map((role) => (
          <li key={role.id}>
            <label className="flex items-center gap-2 rounded-xl border-2 border-border bg-surface p-3">
              <input
                type="checkbox"
                name="roleId"
                value={role.id}
                defaultChecked={selected.has(role.id)}
                className="size-4"
              />
              <span className="font-medium">{role.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="submit"
        className="rounded-full border-2 border-border bg-gdg-blue px-6 py-2.5 font-bold text-primary-foreground transition hover:brightness-95"
      >
        役割を保存
      </button>
    </Form>
  );
}
