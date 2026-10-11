import { Button, Checkbox, FormField, Heading, Input } from "@gdgjp/design-system";
import { Form } from "react-router";
import { ROLE_NAME_MAX_LENGTH, canCreateCustomRole } from "~/features/schedule/role-name";
import type { Role } from "~/features/schedule/roles.server";

/**
 * The "使う役割" card on `/e/:id/s/:sheetId/design` (docs/roster/index.md §3
 * "役割マスタ"). The checkbox form toggles this sheet's `roster_sheet_roles`
 * selection among the six seeded roles and the event's own roles. Below it,
 * the event's own roles (ADR-011) are created, renamed, and deleted; they
 * are shared by every sheet of the event and its apply form, and a newly
 * created one starts selected on this sheet. Forms can't nest, so the
 * management forms are siblings of the checkbox form. `error` is a failed
 * role action's message, shown here rather than at the top of the page.
 *
 * The create button is deliberately not labelled "役割を追加" — that is the
 * demand matrix's add-column button, which tests look up by name.
 */
export function RolePicker({
  roles,
  selectedRoleIds,
  sheetId,
  error,
}: { roles: Role[]; selectedRoleIds: string[]; sheetId: string; error?: string }) {
  const selected = new Set(selectedRoleIds);
  const customRoles = roles.filter((role) => role.custom);

  return (
    <div className="space-y-6">
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

      <section aria-labelledby="custom-roles-heading" className="space-y-3 border-t pt-4">
        <Heading id="custom-roles-heading" level={3}>
          このイベントの独自の役割
        </Heading>
        <p className="gdg-muted text-sm">
          独自の役割はこのイベントのすべてのシフト表と応募フォームで共通です。名前の変更もすべてに反映されます。
        </p>
        {error ? (
          <p role="alert" className="text-sm font-medium text-gdg-red">
            {error}
          </p>
        ) : null}
        {customRoles.length === 0 ? (
          <p className="gdg-muted text-sm">独自の役割はまだありません。</p>
        ) : (
          <ul className="space-y-2">
            {customRoles.map((role) => (
              <li
                key={`${role.id}:${role.name}`}
                className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
              >
                <Form method="post" className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                  <input type="hidden" name="intent" value="renameRole" />
                  <input type="hidden" name="roleId" value={role.id} />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <FormField label={`「${role.name}」の名前`} hideLabel className="min-w-40 flex-1">
                    <Input
                      name="name"
                      defaultValue={role.name}
                      required
                      maxLength={ROLE_NAME_MAX_LENGTH}
                    />
                  </FormField>
                  <Button type="submit" variant="outline" size="sm">
                    名前を変更
                  </Button>
                </Form>
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `「${role.name}」を削除します。応募者のこの役割の経験・希望も削除されます。よろしいですか？`,
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="deleteRole" />
                  <input type="hidden" name="roleId" value={role.id} />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    aria-label={`「${role.name}」を削除`}
                  >
                    削除
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        )}
        {canCreateCustomRole(roles) ? (
          // Keyed by the count so a successful create remounts the form and clears the input.
          <Form key={customRoles.length} method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="createRole" />
            <input type="hidden" name="sheetId" value={sheetId} />
            <FormField label="新しい役割" required className="min-w-44 flex-1">
              <Input name="name" required maxLength={ROLE_NAME_MAX_LENGTH} placeholder="クローク" />
            </FormField>
            <Button type="submit" variant="secondary">
              役割を作成
            </Button>
          </Form>
        ) : (
          <p className="gdg-muted text-sm">独自の役割は上限まで作成済みです。</p>
        )}
      </section>
    </div>
  );
}
