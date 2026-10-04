import { useEffect, useRef } from "react";
import { Form } from "react-router";
import type { Phase } from "~/features/schedule/schedule.server";
import type { Role, Track } from "~/features/schedule/tracks.server";
import type { MatrixMode } from "../matrix";
import type { DemandValue } from "../types";

/**
 * The demand-cell editor on `/e/:id/design` (docs/roster/03-demand-input.md
 * "Design" §4). Rendered as a native modal dialog aligned to the right edge,
 * matching the editing drawer used throughout the admin surface without
 * adding an app-local UI primitive layer.
 *
 * Bulk copy (§3(b)) is two independent checkbox groups rather than a full
 * (phase x track) picker: "copy this value to these other tracks, keeping
 * the same row" and, in phase mode, "copy it to these other phases, keeping
 * the same track". Combining both axes in one copy isn't offered — running
 * the copy twice covers that case — which keeps this form to the size the
 * stage's manual E2E actually exercises (step 8: one row, one other track).
 */
export function DemandDrawer({
  mode,
  rowKey,
  rowLabel,
  trackId,
  roleId,
  value,
  tracks,
  roles,
  phases,
  onClose,
  sheetId,
}: {
  mode: MatrixMode;
  rowKey: string;
  rowLabel: string;
  trackId: string;
  roleId: string;
  value: DemandValue;
  tracks: readonly Track[];
  roles: readonly Role[];
  phases: readonly Phase[];
  onClose: () => void;
  sheetId: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const trackName = tracks.find((t) => t.id === trackId)?.name ?? trackId;
  const roleName = roles.find((r) => r.id === roleId)?.name ?? roleId;
  const otherTracks = tracks.filter((t) => t.id !== trackId);
  const otherPhases = phases.filter((p) => p.id !== rowKey);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="demand-drawer-title"
      className="roster-drawer"
    >
      <div className="max-h-dvh space-y-4 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-neutral-500">
              {rowLabel} / {trackName}
            </p>
            <h3 id="demand-drawer-title" className="text-lg font-bold">
              {roleName}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="text-sm font-medium text-neutral-500 underline"
          >
            閉じる
          </button>
        </div>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="sheetId" value={sheetId} />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="rowKey" value={rowKey} />
          <input type="hidden" name="trackId" value={trackId} />
          <input type="hidden" name="roleId" value={roleId} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField name="min" label="最小" defaultValue={value.min} />
            <NumberField name="ideal" label="理想" defaultValue={value.ideal} />
            <NumberField name="leadMin" label="リード最小" defaultValue={value.leadMin} />
            <NumberField name="newMax" label="初参加上限" defaultValue={value.newMax} />
          </div>

          {otherTracks.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">他のトラックへコピー</legend>
              <div className="flex flex-wrap gap-3">
                {otherTracks.map((track) => (
                  <label key={track.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="copyTrackId" value={track.id} className="size-4" />
                    {track.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {mode === "phase" && otherPhases.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">他のフェーズへコピー</legend>
              <div className="flex flex-wrap gap-3">
                {otherPhases.map((phase) => (
                  <label key={phase.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="copyRowKey" value={phase.id} className="size-4" />
                    {phase.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="intent"
              value="saveDemand"
              className="rounded-full border-2 border-black bg-gdg-blue px-5 py-2 font-bold text-white transition hover:brightness-95"
            >
              保存
            </button>
            <button
              type="submit"
              name="intent"
              value="copyDemand"
              className="rounded-full border-2 border-black bg-white px-5 py-2 font-bold transition hover:bg-neutral-100"
            >
              保存してコピー
            </button>
            {value.ideal > 0 ? (
              <button
                type="submit"
                name="intent"
                value="saveDemand"
                formNoValidate
                className="ml-auto text-sm font-medium text-gdg-red underline"
                onClick={(e) => {
                  // Zero every field client-side before submit — ideal=0
                  // means "no demand" and must carry zeroed siblings
                  // (validate.ts's IDEAL_ZERO_REQUIRES_ZEROED_FIELDS).
                  const form = e.currentTarget.form;
                  if (!form) return;
                  for (const name of ["min", "ideal", "leadMin", "newMax"]) {
                    const input = form.elements.namedItem(name);
                    if (input instanceof HTMLInputElement) input.value = "0";
                  }
                }}
              >
                この需要を削除
              </button>
            ) : null}
          </div>
        </Form>
      </div>
    </dialog>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: number;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        required
        defaultValue={defaultValue}
        className="w-full rounded-xl border-2 border-black bg-white p-2 outline-none focus:ring-4 focus:ring-gdg-blue/40"
      />
    </label>
  );
}
