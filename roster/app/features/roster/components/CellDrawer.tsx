import { useEffect, useRef } from "react";
import { Form, useNavigation } from "react-router";
import type { StaffCellCandidate } from "../grid";

export type CellDrawerSelection = {
  applicationId: string;
  applicationName: string;
  slotId: string;
  slotLabel: string;
};

export type CrossSheetAssignmentWarning = {
  conflicts: readonly {
    sheetId: string;
    sheetName: string;
    date: string;
    siblingSlotId: string;
    startTime: string;
    endTime: string;
    targetSlotId: string;
    targetStartTime: string;
    targetEndTime: string;
  }[];
  assignment: {
    applicationId: string;
    trackId: string;
    roleId: string;
    slotIds: readonly string[];
  };
  confirmation: string;
};

const NEW_MAX_DEFAULT = 99;

/**
 * The staff × slot cell editor (docs/roster/07-roster-manual-edit.md
 * "Design" §5a): "そのスタッフのその枠をどこに割り当てるか." Every candidate
 * comes from `grid.ts#buildStaffCellCandidates`, which already ran
 * `hardViolations` — this component only renders the result, it never
 * decides whether a placement is safe.
 *
 * **Warn-and-allow, not warn-and-block**: a candidate with warnings still
 * gets a normal, always-enabled "割り当てる" submit button
 * (docs/roster/index.md §5.1: "手動編集ではこれらを警告のうえ許可する" — the
 * asymmetry with auto-generation is deliberate, do not disable this button
 * when warnings exist).
 */
export function CellDrawer({
  selection,
  current,
  candidates,
  trackNameById,
  roleNameById,
  error,
  crossSheetWarning,
  succeeded,
  onClose,
}: {
  selection: CellDrawerSelection | null;
  current: { trackId: string; roleId: string } | null;
  candidates: readonly StaffCellCandidate[];
  trackNameById: ReadonlyMap<string, string>;
  roleNameById: ReadonlyMap<string, string>;
  error?: string;
  crossSheetWarning?: CrossSheetAssignmentWarning;
  /** A fresh truthy value only on a successful assign/unassign — see `StaffDrawer`'s identical contract. */
  succeeded: unknown;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigation = useNavigation();

  useEffect(() => {
    if (selection) dialogRef.current?.showModal();
  }, [selection]);

  useEffect(() => {
    if (succeeded) dialogRef.current?.close();
  }, [succeeded]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="cell-drawer-title"
      className="roster-drawer"
    >
      {selection ? (
        <div className="max-h-[85vh] space-y-4 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-500">{selection.slotLabel}</p>
              <h3 id="cell-drawer-title" className="text-lg font-bold">
                {selection.applicationName}
              </h3>
            </div>
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

          {crossSheetWarning ? (
            <section
              role="alert"
              aria-labelledby="cross-sheet-warning-title"
              className="space-y-2 rounded-xl border-2 border-gdg-red bg-surface p-3 text-sm"
            >
              <h4 id="cross-sheet-warning-title" className="font-bold text-gdg-red">
                {crossSheetWarning.conflicts.length > 0
                  ? "別のシフト表の割当と時間が重複しています"
                  : "別シフト表の割当状況が変わりました。最新の状態を確認してください。"}
              </h4>
              <ul className="list-disc space-y-1 pl-5">
                {crossSheetWarning.conflicts.map((conflict) => (
                  <li
                    key={`${conflict.targetSlotId}:${conflict.sheetId}:${conflict.siblingSlotId}`}
                  >
                    対象 {conflict.targetStartTime}–{conflict.targetEndTime} と重複:{" "}
                    {conflict.sheetName}（{conflict.date}）{conflict.startTime}–{conflict.endTime}
                  </li>
                ))}
              </ul>
              <Form method="post">
                <input type="hidden" name="intent" value="assign" />
                <input
                  type="hidden"
                  name="applicationId"
                  value={crossSheetWarning.assignment.applicationId}
                />
                <input type="hidden" name="trackId" value={crossSheetWarning.assignment.trackId} />
                <input type="hidden" name="roleId" value={crossSheetWarning.assignment.roleId} />
                {crossSheetWarning.assignment.slotIds.map((slotId) => (
                  <input key={slotId} type="hidden" name="slotId" value={slotId} />
                ))}
                <input
                  type="hidden"
                  name="conflictConfirmation"
                  value={crossSheetWarning.confirmation}
                />
                <button
                  type="submit"
                  disabled={
                    navigation.state !== "idle" &&
                    navigation.formData?.get("conflictConfirmation") ===
                      crossSheetWarning.confirmation
                  }
                  aria-busy={
                    navigation.state !== "idle" &&
                    navigation.formData?.get("conflictConfirmation") ===
                      crossSheetWarning.confirmation
                  }
                  className="min-h-11 rounded-full border-2 border-gdg-red px-4 py-2 font-bold text-gdg-red underline"
                >
                  {navigation.state !== "idle" &&
                  navigation.formData?.get("conflictConfirmation") ===
                    crossSheetWarning.confirmation
                    ? "割り当て中…"
                    : crossSheetWarning.conflicts.length > 0
                      ? "重複を承知で割り当てる"
                      : "最新の内容を確認して割り当てる"}
                </button>
              </Form>
            </section>
          ) : null}

          {current ? (
            <div className="flex items-center justify-between rounded-xl border-2 border-border bg-neutral-50 p-3">
              <p className="text-sm">
                現在: {trackNameById.get(current.trackId) ?? current.trackId} /{" "}
                {roleNameById.get(current.roleId) ?? current.roleId}
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="unassign" />
                <input type="hidden" name="applicationId" value={selection.applicationId} />
                <input type="hidden" name="slotId" value={selection.slotId} />
                <button type="submit" className="text-sm font-medium text-gdg-red underline">
                  外す
                </button>
              </Form>
            </div>
          ) : (
            <p className="text-sm text-neutral-600">この枠には割り当てられていません。</p>
          )}

          <ul className="space-y-2">
            {candidates.map((c) => {
              const isCurrent = current?.trackId === c.trackId && current?.roleId === c.roleId;
              return (
                <li
                  key={`${c.trackId}:${c.roleId}`}
                  className="rounded-xl border-2 border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold">
                        {trackNameById.get(c.trackId) ?? c.trackId} /{" "}
                        {roleNameById.get(c.roleId) ?? c.roleId}
                      </p>
                      <p className="text-xs text-neutral-500">
                        人数 {c.current}/{c.demand.ideal}
                        {c.demand.leadMin > 0
                          ? ` ・ リード ${c.leadCurrent}/${c.demand.leadMin}`
                          : ""}
                        {c.demand.newMax < NEW_MAX_DEFAULT
                          ? ` ・ 初参加 ${c.newCurrent}/${c.demand.newMax}`
                          : ""}
                      </p>
                    </div>
                    {isCurrent ? (
                      <span className="text-xs font-bold text-gdg-blue">現在の割当</span>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="assign" />
                        <input type="hidden" name="applicationId" value={selection.applicationId} />
                        <input type="hidden" name="slotId" value={selection.slotId} />
                        <input type="hidden" name="trackId" value={c.trackId} />
                        <input type="hidden" name="roleId" value={c.roleId} />
                        <button
                          type="submit"
                          className="rounded-full border-2 border-border bg-gdg-blue px-3 py-1 text-xs font-bold text-primary-foreground transition hover:brightness-95"
                        >
                          割り当てる
                        </button>
                      </Form>
                    )}
                  </div>
                  {c.warnings.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-xs text-gdg-red">
                      {c.warnings.map((w) => (
                        <li key={w}>⚠ {w}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </dialog>
  );
}
