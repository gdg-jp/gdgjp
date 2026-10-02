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
import { AvailabilityGrid, type AvailabilityGridSlot } from "./AvailabilityGrid";
import { RoleSkillRow } from "./RoleSkillRow";

export type ApplyFormOwn = {
  name: string;
  contact: string;
  party: PartyStatus;
  note: string;
  withdrawn: boolean;
  skills: { roleId: string; level: Level; pref: Pref }[];
  availability: { timeSlotId: string; value: AvailabilityValue }[];
};

export type ApplyFormRosterSheet = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  timeSlots: AvailabilityGridSlot[];
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
      {error ? (
        <p role="alert" className="text-sm font-medium text-gdg-red">
          {error}
        </p>
      ) : null}

      {own?.withdrawn ? (
        <p className="rounded-xl border-2 border-black bg-neutral-100 p-3 text-sm">
          この登録は辞退済みです。内容を保存すると再度有効になります。
        </p>
      ) : null}

      <label className="block space-y-1">
        <span className="text-sm font-medium">表示名</span>
        <input
          name="name"
          required
          defaultValue={own?.name ?? defaultName}
          className="w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">当日の連絡手段（任意）</span>
        <input
          name="contact"
          defaultValue={own?.contact ?? ""}
          placeholder="未入力の場合はアカウントのメールを使用します"
          className="w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        />
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">担当できる役割</legend>
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

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">稼働可能時間</legend>
        {availabilitySheets.length === 0 ? (
          <output className="text-sm text-muted-foreground">
            回答できるシフト表がありません。
          </output>
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
        <label className="block space-y-1">
          <span className="text-sm font-medium">懇親会</span>
          <select
            name="party"
            defaultValue={own?.party ?? DEFAULT_PARTY}
            className="w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
          >
            {PARTY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PARTY_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block space-y-1">
        <span className="text-sm font-medium">備考（任意）</span>
        <textarea
          name="note"
          rows={3}
          defaultValue={own?.note ?? ""}
          className="w-full rounded-xl border-2 border-black bg-white p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          className="rounded-full border-2 border-black bg-gdg-blue px-6 py-2.5 font-bold text-white transition hover:brightness-95"
        >
          {own ? "登録内容を更新" : "登録する"}
        </button>
        {own ? (
          <button
            type="submit"
            name="intent"
            value="withdraw"
            formNoValidate
            className="rounded-full border-2 border-black bg-white px-6 py-2.5 font-bold text-gdg-red transition hover:bg-neutral-100"
          >
            辞退する
          </button>
        ) : null}
      </div>
    </Form>
  );
}
