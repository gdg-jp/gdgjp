import { FormField, NativeSelect, NativeSelectOption } from "@gdgjp/design-system";
import {
  LEVELS,
  LEVEL_DESCRIPTIONS,
  LEVEL_LABELS,
  type Level,
  PREFS,
  PREF_LABELS,
  type Pref,
} from "~/features/applications/types";

/**
 * One role in the "担当できる役割" fieldset (docs/roster/04-applications.md
 * "Design" §2): a checkbox, and — only once checked — its level/pref
 * selects. Hiding them until checked is the "選択済みの役割にのみ追加で問う"
 * input-load rule from the stage doc; it also means an unchecked role's
 * `name="level_<id>"`/`name="pref_<id>"` inputs don't exist in the DOM at
 * all, so the server route only has to read the roles the applicant
 * actually checked.
 */
export function RoleSkillRow({
  role,
  selected,
  level,
  pref,
  onSelectedChange,
  onLevelChange,
  onPrefChange,
}: {
  role: { id: string; name: string };
  selected: boolean;
  level: Level;
  pref: Pref;
  onSelectedChange: (selected: boolean) => void;
  onLevelChange: (level: Level) => void;
  onPrefChange: (pref: Pref) => void;
}) {
  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name={`role_${role.id}`}
          checked={selected}
          onChange={(e) => onSelectedChange(e.target.checked)}
          className="size-4 accent-gdg-blue"
        />
        <span className="text-sm font-medium">{role.name}</span>
      </label>

      {selected ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField id={`level-${role.id}`} label="経験レベル">
            <NativeSelect
              name={`level_${role.id}`}
              value={level}
              onChange={(e) => onLevelChange(e.target.value as Level)}
            >
              {LEVELS.map((l) => (
                <NativeSelectOption key={l} value={l}>
                  {LEVEL_LABELS[l]} — {LEVEL_DESCRIPTIONS[l]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id={`pref-${role.id}`} label="希望度">
            <NativeSelect
              name={`pref_${role.id}`}
              value={pref}
              onChange={(e) => onPrefChange(Number(e.target.value) as Pref)}
            >
              {PREFS.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {PREF_LABELS[p]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
        </div>
      ) : null}
    </li>
  );
}
