import { Button, Checkbox } from "@gdgjp/design-system";
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
            <label
              htmlFor={`role-${role.id}`}
              className="flex min-h-11 items-center gap-2 rounded-lg border p-3"
            >
              <Checkbox
                id={`role-${role.id}`}
                name="roleId"
                value={role.id}
                defaultChecked={selected.has(role.id)}
              />
              <span className="font-medium">{role.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <Button type="submit" variant="secondary">
        役割を保存
      </Button>
    </Form>
  );
}
