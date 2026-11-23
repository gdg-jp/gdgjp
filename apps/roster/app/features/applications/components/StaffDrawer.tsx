import { useEffect, useMemo, useRef, useState } from "react";
import { Form } from "react-router";
import {
  type AvailabilityValue,
  DEFAULT_LEVEL,
  DEFAULT_PREF,
  type Level,
  type Pref,
} from "~/features/applications/types";
import { type ApplyFormRosterSheet, applyAvailabilityBulkChange } from "./ApplyForm";
import type { AvailabilityGridSlot } from "./AvailabilityGrid";
import {
  AvailabilitySheetGrids,
  availabilitySlots,
  buildAvailabilityState,
} from "./AvailabilitySheetGrids";
import { RoleSkillRow } from "./RoleSkillRow";

export type StaffDrawerDetail = {
  applicationId: string;
  name: string;
  withdrawn: boolean;
  skills: { roleId: string; level: Level; pref: Pref }[];
  availability: { timeSlotId: string; value: AvailabilityValue }[];
};

type SkillState = { selected: boolean; level: Level; pref: Pref };

export function StaffDrawer({
  detail,
  roles,
  rosterSheets,
  timeSlots,
  error,
  succeeded,
  onClose,
}: {
  detail: StaffDrawerDetail | null;
  roles: { id: string; name: string }[];
  rosterSheets?: readonly ApplyFormRosterSheet[];
  timeSlots?: AvailabilityGridSlot[];
  error?: string;
  succeeded: unknown;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const allTimeSlots = useMemo(
    () => availabilitySlots(rosterSheets, timeSlots),
    [rosterSheets, timeSlots],
  );
  const [skills, setSkills] = useState<Record<string, SkillState>>({});
  const [availability, setAvailability] = useState<Record<string, AvailabilityValue>>(() =>
    buildAvailabilityState(allTimeSlots, detail?.availability ?? [], "x"),
  );

  useEffect(() => {
    if (!detail) return;
    setSkills(
      Object.fromEntries(
        roles.map((role) => {
          const existing = detail.skills.find((s) => s.roleId === role.id);
          const state: SkillState = existing
            ? { selected: true, level: existing.level, pref: existing.pref }
            : { selected: false, level: DEFAULT_LEVEL, pref: DEFAULT_PREF };
          return [role.id, state];
        }),
      ),
    );
    setAvailability(buildAvailabilityState(allTimeSlots, detail.availability, "x"));
    dialogRef.current?.showModal();
  }, [detail, roles, allTimeSlots]);

  useEffect(() => {
    if (succeeded) dialogRef.current?.close();
  }, [succeeded]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="staff-drawer-title"
      className="roster-drawer"
    >
      {detail ? (
        <Form method="post" className="max-h-[85vh] space-y-6 overflow-y-auto p-6">
          <input type="hidden" name="intent" value="correct" />
          <input type="hidden" name="applicationId" value={detail.applicationId} />

          <div className="flex items-center justify-between">
            <h2 id="staff-drawer-title" className="text-lg font-bold">
              {detail.name} の補正
            </h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="text-sm underline"
            >
              閉じる
            </button>
          </div>

          {error ? (
            <p role="alert" className="text-sm font-medium text-gdg-red">
              {error}
            </p>
          ) : null}

          {detail.withdrawn ? (
            <p className="rounded-xl border-2 border-border bg-neutral-100 p-3 text-sm">
              この登録は辞退済みです。保存すると再度有効になります。
            </p>
          ) : null}

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
            <legend className="text-sm font-medium">参加できない時間</legend>
            <AvailabilitySheetGrids
              rosterSheets={rosterSheets}
              timeSlots={timeSlots}
              values={availability}
              onChange={(timeSlotId, value) =>
                setAvailability((a) => ({ ...a, [timeSlotId]: value }))
              }
              onBulkChange={(sheet, compute) =>
                setAvailability((current) =>
                  applyAvailabilityBulkChange(current, sheet.timeSlots, compute),
                )
              }
            />
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="intent"
              value="correct"
              className="rounded-full border-2 border-border bg-gdg-blue px-6 py-2.5 font-bold text-primary-foreground transition hover:brightness-95"
            >
              保存
            </button>
            <button
              type="submit"
              name="intent"
              value="withdraw"
              formNoValidate
              className="rounded-full border-2 border-border bg-surface px-6 py-2.5 font-bold text-gdg-red transition hover:bg-neutral-100"
            >
              辞退にする
            </button>
          </div>
        </Form>
      ) : null}
    </dialog>
  );
}
