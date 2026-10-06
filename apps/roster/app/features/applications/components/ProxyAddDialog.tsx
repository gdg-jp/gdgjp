import { useEffect, useMemo, useRef, useState } from "react";
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
import { type ApplyFormRosterSheet, applyAvailabilityBulkChange } from "./ApplyForm";
import type { AvailabilityGridSlot } from "./AvailabilityGrid";
import {
  AvailabilitySheetGrids,
  availabilitySlots,
  buildAvailabilityState,
} from "./AvailabilitySheetGrids";
import { RoleSkillRow } from "./RoleSkillRow";

type SkillState = { selected: boolean; level: Level; pref: Pref };

function buildInitialSkills(roles: readonly { id: string }[]): Record<string, SkillState> {
  return Object.fromEntries(
    roles.map((role) => [role.id, { selected: false, level: DEFAULT_LEVEL, pref: DEFAULT_PREF }]),
  );
}

/**
 * Owner-side proxy registration (ADR-008, docs/roster/04-applications.md
 * "Design" §3): the entry point for adding someone who told the organizer
 * in person or on the day, identified by email since `accounts` has no
 * user-search API. This is the ONLY staff-management UI Stage 04 builds —
 * the full staff list/table with per-row edit is Stage 05's job
 * (docs/roster/04-applications.md "Design" §4 制約).
 *
 * Same fields as self-registration (`ApplyForm`), plus the email that
 * identifies who this becomes once they sign in and open `/apply/:token`.
 * `e.$id.staff.tsx`'s action upserts by (event, email): a second submission
 * with the same email edits that row instead of creating a duplicate — the
 * same "last write wins" rule as self-edits (ADR-008).
 */
export function ProxyAddDialog({
  hasParty,
  roles,
  rosterSheets,
  timeSlots,
  error,
  succeeded,
}: {
  hasParty: boolean;
  roles: { id: string; name: string }[];
  rosterSheets?: readonly ApplyFormRosterSheet[];
  timeSlots?: AvailabilityGridSlot[];
  error?: string;
  /**
   * A fresh truthy value (the route's `actionData`) only when the last
   * submission succeeded — `undefined` on error or before any submission.
   * The caller must compute this (an error response is also a truthy
   * object), not just forward `actionData` as-is.
   */
  succeeded: unknown;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const allTimeSlots = useMemo(
    () => availabilitySlots(rosterSheets, timeSlots),
    [rosterSheets, timeSlots],
  );
  const [skills, setSkills] = useState<Record<string, SkillState>>(() => buildInitialSkills(roles));
  const [availability, setAvailability] = useState<Record<string, AvailabilityValue>>(() =>
    buildAvailabilityState(allTimeSlots, [], "o"),
  );

  // Reset the form and close the dialog only on a successful submission —
  // an error must leave the owner's in-progress input exactly as they typed
  // it. `succeeded` (a fresh object only on success) is the actual trigger;
  // `roles`/`timeSlots` are listed only to satisfy exhaustive-deps; the
  // `if (!succeeded) return` guard makes re-running on their change a no-op.
  useEffect(() => {
    if (!succeeded) return;
    setSkills(buildInitialSkills(roles));
    setAvailability(buildAvailabilityState(allTimeSlots, [], "o"));
    formRef.current?.reset();
    dialogRef.current?.close();
  }, [succeeded, roles, allTimeSlots]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-full border-2 border-border bg-gdg-blue px-6 py-2.5 font-bold text-primary-foreground transition hover:brightness-95"
      >
        メールアドレスで代理登録
      </button>
      <dialog ref={dialogRef} aria-labelledby="proxy-add-title" className="roster-drawer">
        <Form method="post" ref={formRef} className="max-h-[85vh] space-y-6 overflow-y-auto p-6">
          <input type="hidden" name="intent" value="proxyAdd" />
          <div className="flex items-center justify-between">
            <h2 id="proxy-add-title" className="text-lg font-bold">
              代理登録
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

          <label className="block space-y-1">
            <span className="text-sm font-medium">メールアドレス</span>
            <input
              type="email"
              name="email"
              required
              className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">表示名</span>
            <input
              name="name"
              required
              className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">当日の連絡手段（任意）</span>
            <input
              name="contact"
              placeholder="未入力の場合はメールアドレスを使用します"
              className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
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

          {hasParty ? (
            <label className="block space-y-1">
              <span className="text-sm font-medium">懇親会</span>
              <select
                name="party"
                defaultValue={DEFAULT_PARTY satisfies PartyStatus}
                className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
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
              className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>

          <button
            type="submit"
            className="rounded-full border-2 border-border bg-gdg-blue px-6 py-2.5 font-bold text-primary-foreground transition hover:brightness-95"
          >
            登録する
          </button>
        </Form>
      </dialog>
    </>
  );
}
