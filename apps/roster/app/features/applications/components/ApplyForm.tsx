import {
  Alert,
  Button,
  FormField,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@gdgjp/design-system";
import { useState } from "react";
import { Form } from "react-router";
import {
  type AvailabilityValue,
  DEFAULT_LEVEL,
  DEFAULT_PARTY,
  DEFAULT_PREF,
  type Level,
  PARTY_LABELS,
  PARTY_STATUSES,
  type PartyStatus,
  type Pref,
} from "~/features/applications/types";
import {
  AvailabilityGrid,
  type AvailabilityGridSlot,
  type AvailabilityRosterSheet,
} from "./AvailabilityGrid";
import { RoleSkillRow } from "./RoleSkillRow";

export type ApplyFormRosterSheet = AvailabilityRosterSheet;

export type ApplyFormOwn = {
  name: string;
  contact: string;
  party: PartyStatus;
  note: string;
  withdrawn: boolean;
  skills: { roleId: string; level: Level; pref: Pref }[];
  availability: { timeSlotId: string; value: AvailabilityValue }[];
};

type ApplyFormProps = {
  hasParty: boolean;
  roles: { id: string; name: string }[];
  own: ApplyFormOwn | null;
  defaultName: string;
  error?: string;
  /** Grouped sheets are the preferred input; `timeSlots` remains for the current route. */
  rosterSheets?: readonly ApplyFormRosterSheet[];
  timeSlots?: AvailabilityGridSlot[];
};

type SkillState = { selected: boolean; level: Level; pref: Pref };

/**
 * The self-registration / self-edit form on `/apply/:token`
 * (docs/roster/04-applications.md "Design" §2). `own` is `null` for a
 * first-time registration and populated for an edit — same fields either
 * way, since the route always resolves to one of "create" or "update" and
 * never shows a form for someone else's application (the loader only ever
 * passes the viewer's own data, see `apply.$token.tsx`).
 */
export function applyAvailabilityBulkChange(
  current: Readonly<Record<string, AvailabilityValue>>,
  timeSlots: readonly AvailabilityGridSlot[],
  compute: (slot: AvailabilityGridSlot) => AvailabilityValue,
): Record<string, AvailabilityValue> {
  return {
    ...current,
    ...Object.fromEntries(timeSlots.map((slot) => [slot.id, compute(slot)])),
  };
}

export function ApplyForm({
  hasParty,
  roles,
  timeSlots = [],
  rosterSheets,
  own,
  defaultName,
  error,
}: ApplyFormProps) {
  const availabilitySheets: readonly ApplyFormRosterSheet[] = rosterSheets ?? [
    {
      id: "event",
      name: "",
      date: "",
      startTime: "",
      endTime: "",
      timeSlots,
    },
  ];
  const allTimeSlots = availabilitySheets.flatMap((sheet) => sheet.timeSlots);
  const [skills, setSkills] = useState<Record<string, SkillState>>(() =>
    Object.fromEntries(
      roles.map((role) => {
        const existing = own?.skills.find((s) => s.roleId === role.id);
        const state: SkillState = existing
          ? { selected: true, level: existing.level, pref: existing.pref }
          : { selected: false, level: DEFAULT_LEVEL, pref: DEFAULT_PREF };
        return [role.id, state];
      }),
    ),
  );
  const [availability, setAvailability] = useState<Record<string, AvailabilityValue>>(() =>
    Object.fromEntries(
      allTimeSlots.map((slot) => [
        slot.id,
        own?.availability.find((a) => a.timeSlotId === slot.id)?.value ?? "o",
      ]),
    ),
  );

  return (
    <Form method="post" className="space-y-6">
      {error ? <Alert tone="danger" title={error} /> : null}

      {own?.withdrawn ? (
        <Alert tone="info" title="この登録は辞退済みです。">
          内容を保存すると再度有効になります。
        </Alert>
      ) : null}

      <FormField id="apply-name" label="表示名" required>
        <Input name="name" required defaultValue={own?.name ?? defaultName} />
      </FormField>

      <FormField
        id="apply-contact"
        label="当日の連絡手段（任意）"
        description="未入力の場合はアカウントのメールを使用します"
      >
        <Input name="contact" defaultValue={own?.contact ?? ""} />
      </FormField>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">担当できる役割</legend>
        <ul className="space-y-2">
          {roles.map((role) => (
            <RoleSkillRow
              key={role.id}
              role={role}
              selected={skills[role.id]?.selected ?? false}
              level={skills[role.id]?.level ?? DEFAULT_LEVEL}
              pref={skills[role.id]?.pref ?? DEFAULT_PREF}
              onSelectedChange={(selected) =>
                setSkills((s) => ({ ...s, [role.id]: { ...s[role.id], selected } }))
              }
              onLevelChange={(level) =>
                setSkills((s) => ({ ...s, [role.id]: { ...s[role.id], level } }))
              }
              onPrefChange={(pref) =>
                setSkills((s) => ({ ...s, [role.id]: { ...s[role.id], pref } }))
              }
            />
          ))}
        </ul>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">参加できない時間</legend>
        {availabilitySheets.length === 0 ? (
          <output className="text-sm text-muted">回答できるシフト表がありません。</output>
        ) : (
          <div className="space-y-5">
            {availabilitySheets.map((sheet) => {
              const grid = (
                <AvailabilityGrid
                  timeSlots={sheet.timeSlots}
                  values={availability}
                  onChange={(timeSlotId, value) =>
                    setAvailability((current) => ({ ...current, [timeSlotId]: value }))
                  }
                  onBulkChange={(compute) =>
                    setAvailability((current) =>
                      applyAvailabilityBulkChange(current, sheet.timeSlots, compute),
                    )
                  }
                />
              );

              if (!sheet.name) return <div key={sheet.id}>{grid}</div>;

              return (
                <fieldset key={sheet.id} className="space-y-3 rounded-lg border border-border p-3">
                  <legend className="max-w-full px-1 text-sm font-semibold">
                    {sheet.name}
                    {sheet.date ? ` — ${sheet.date}` : ""}
                    {sheet.startTime && sheet.endTime ? ` ${sheet.startTime}–${sheet.endTime}` : ""}
                  </legend>
                  {grid}
                </fieldset>
              );
            })}
          </div>
        )}
      </fieldset>

      {hasParty ? (
        <FormField id="apply-party" label="懇親会">
          <NativeSelect name="party" defaultValue={own?.party ?? DEFAULT_PARTY}>
            {PARTY_STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {PARTY_LABELS[status]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
      ) : null}

      <FormField id="apply-note" label="備考（任意）">
        <Textarea name="note" rows={3} defaultValue={own?.note ?? ""} />
      </FormField>

      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <Button type="submit" name="intent" value="save">
          {own ? "登録内容を更新" : "登録する"}
        </Button>
        {own ? (
          <Button type="submit" name="intent" value="withdraw" variant="outline" formNoValidate>
            辞退する
          </Button>
        ) : null}
      </div>
    </Form>
  );
}
