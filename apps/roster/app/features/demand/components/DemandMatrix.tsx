import { useMemo, useRef, useState } from "react";
import type { Role } from "~/features/schedule/roles.server";
import type { Phase, TimeSlot } from "~/features/schedule/schedule.server";
import type { Track } from "~/features/schedule/tracks.server";
import {
  type DemandColumn,
  type MatrixMode,
  buildColumns,
  buildPhaseRows,
  buildSlotRows,
  columnKey,
} from "../matrix";
import type { Demand } from "../types";
import { DemandCell } from "./DemandCell";
import { DemandDrawer } from "./DemandDrawer";

/** The empty-cell default the drawer opens with — all zero, the only value shape that means "no demand" (validate.ts). */
const NO_DEMAND = { min: 0, ideal: 0, leadMin: 0, newMax: 0 };

type Selection = { rowKey: string; rowLabel: string; trackId: string; roleId: string };

/**
 * The demand matrix card on `/e/:id/design`
 * (docs/roster/03-demand-input.md "Design" §4). `roles` here must already
 * be filtered to the event's selected roles (`event_roles`) — the caller
 * (the route) does that filtering, matching the "役割を追加" affordance's
 * "イベントで選択済みの役割" scope (§3).
 */
export function DemandMatrix({
  phases,
  timeSlots,
  tracks,
  roles,
  demands,
  sheetId,
}: {
  phases: Phase[];
  timeSlots: TimeSlot[];
  tracks: Track[];
  roles: Role[];
  demands: Demand[];
  sheetId: string;
}) {
  const [mode, setMode] = useState<MatrixMode>("phase");
  const [selection, setSelection] = useState<Selection | null>(null);
  // Columns opened via "役割を追加" with no saved value yet — purely
  // client-side. The moment a real value is saved for one, buildColumns
  // picks it up from `demands` directly and this entry becomes redundant
  // (harmless duplicate, deduped below).
  const [pendingColumns, setPendingColumns] = useState<DemandColumn[]>([]);

  const columns = useMemo(() => {
    const fakePending: Demand[] = pendingColumns.map((c) => ({
      timeSlotId: "__pending__",
      trackId: c.trackId,
      roleId: c.roleId,
      min: 0,
      ideal: 1,
      leadMin: 0,
      newMax: 99,
    }));
    return buildColumns([...demands, ...fakePending], tracks, roles);
  }, [demands, tracks, roles, pendingColumns]);

  const rows = useMemo(
    () =>
      mode === "phase"
        ? buildPhaseRows(phases, timeSlots, demands, columns)
        : buildSlotRows(timeSlots, demands, columns),
    [mode, phases, timeSlots, demands, columns],
  );

  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  const selectedRow = selection ? rows.find((r) => r.key === selection.rowKey) : undefined;
  const selectedCell =
    selectedRow && selection
      ? selectedRow.cells.get(columnKey(selection.trackId, selection.roleId))
      : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ModeToggle mode={mode} onChange={setMode} />
        <AddColumnForm
          tracks={tracks}
          roles={roles}
          onAdd={(column) =>
            setPendingColumns((prev) =>
              prev.some((c) => c.trackId === column.trackId && c.roleId === column.roleId)
                ? prev
                : [...prev, column],
            )
          }
        />
      </div>

      {columns.length === 0 ? (
        <p className="text-sm text-neutral-600">
          需要はまだありません。「役割を追加」から始めてください。
        </p>
      ) : (
        <div className="data-grid-wrap">
          <table className="data-grid data-grid-numeric">
            <thead>
              <TrackHeaderRow columns={columns} trackName={trackName} />
              <tr>
                <th scope="col" className="data-grid-rowhead data-grid-colhead-sub">
                  {mode === "phase" ? "フェーズ" : "時間枠"}
                </th>
                {columns.map((col) => (
                  <th
                    key={columnKey(col.trackId, col.roleId)}
                    scope="col"
                    className="data-grid-colhead data-grid-colhead-sub"
                  >
                    {roleName.get(col.roleId) ?? col.roleId}
                  </th>
                ))}
                <th className="data-grid-filler" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="data-grid-rowhead">
                    {row.label}
                  </th>
                  {columns.map((col) => {
                    const key = columnKey(col.trackId, col.roleId);
                    const cell = row.cells.get(key) ?? { kind: "empty" as const };
                    const label = `${row.label} / ${trackName.get(col.trackId) ?? col.trackId} / ${
                      roleName.get(col.roleId) ?? col.roleId
                    }`;
                    return (
                      <td key={key}>
                        <DemandCell
                          cell={cell}
                          label={label}
                          onClick={() =>
                            setSelection({
                              rowKey: row.key,
                              rowLabel: row.label,
                              trackId: col.trackId,
                              roleId: col.roleId,
                            })
                          }
                        />
                      </td>
                    );
                  })}
                  <td className="data-grid-filler" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selection ? (
        <DemandDrawer
          key={`${selection.rowKey}:${selection.trackId}:${selection.roleId}`}
          mode={mode}
          rowKey={selection.rowKey}
          rowLabel={selection.rowLabel}
          trackId={selection.trackId}
          roleId={selection.roleId}
          value={selectedCell?.kind === "value" ? selectedCell.value : NO_DEMAND}
          tracks={tracks}
          roles={roles}
          phases={phases}
          onClose={() => setSelection(null)}
          sheetId={sheetId}
        />
      ) : null}
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: { mode: MatrixMode; onChange: (mode: MatrixMode) => void }) {
  return (
    <div className="segmented">
      {(["phase", "slot"] as const).map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} aria-pressed={mode === m}>
          {m === "phase" ? "フェーズ単位" : "時間枠単位"}
        </button>
      ))}
    </div>
  );
}

function AddColumnForm({
  tracks,
  roles,
  onAdd,
}: { tracks: Track[]; roles: Role[]; onAdd: (column: DemandColumn) => void }) {
  const trackRef = useRef<HTMLSelectElement>(null);
  const roleRef = useRef<HTMLSelectElement>(null);
  if (tracks.length === 0 || roles.length === 0) return null;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-sm">
        <span className="block font-medium">トラック</span>
        <select ref={trackRef} className="rounded-xl border-2 border-border bg-surface p-2">
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="block font-medium">役割</span>
        <select ref={roleRef} className="rounded-xl border-2 border-border bg-surface p-2">
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => {
          const trackId = trackRef.current?.value;
          const roleId = roleRef.current?.value;
          if (trackId && roleId) onAdd({ trackId, roleId });
        }}
        className="rounded-full border-2 border-border bg-surface px-4 py-2 font-bold transition hover:bg-neutral-100"
      >
        役割を追加
      </button>
    </div>
  );
}

/** Groups consecutive same-track columns under one spanning header cell — safe because `buildColumns` sorts by track then role. */
function TrackHeaderRow({
  columns,
  trackName,
}: { columns: DemandColumn[]; trackName: Map<string, string> }) {
  const groups: { trackId: string; span: number }[] = [];
  for (const col of columns) {
    const last = groups[groups.length - 1];
    if (last && last.trackId === col.trackId) {
      last.span += 1;
    } else {
      groups.push({ trackId: col.trackId, span: 1 });
    }
  }
  return (
    <tr>
      <th className="data-grid-rowhead data-grid-colhead-group" />
      {groups.map((g) => (
        <th
          key={g.trackId}
          colSpan={g.span}
          scope="colgroup"
          className="data-grid-colhead data-grid-colhead-group font-bold tracking-wide text-muted uppercase"
        >
          {trackName.get(g.trackId) ?? g.trackId}
        </th>
      ))}
      <th className="data-grid-filler" />
    </tr>
  );
}
