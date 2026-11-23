import { useMemo } from "react";
import type { Assignments, Demand, Report } from "~/features/solver/types";
import { demandKey } from "~/features/solver/types";
import {
  type CellReport,
  VIOLATION_LABELS,
  buildGridColumns,
  gridColumnKey,
  groupAssignmentsByCell,
  indexReportByCell,
} from "../grid";

export type CoverageSlot = { id: string; start: string; end: string };
type TrackInfo = { id: string; name: string; color: string; sortOrder: number };
type RoleInfo = { id: string; name: string; sortOrder: number };

export function DemandCoverageGrid({
  timeSlots,
  tracks,
  roles,
  demands,
  assignments,
  report,
  onSelectCell,
}: {
  timeSlots: readonly CoverageSlot[];
  tracks: readonly TrackInfo[];
  roles: readonly RoleInfo[];
  demands: ReadonlyMap<string, Demand>;
  assignments: Assignments;
  report: Report;
  onSelectCell: (trackId: string, roleId: string, slotIds: string[]) => void;
}) {
  const columns = useMemo(() => buildGridColumns(demands, tracks, roles), [demands, tracks, roles]);
  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const membersByCell = useMemo(() => groupAssignmentsByCell(assignments), [assignments]);
  const reportByCell = useMemo(() => indexReportByCell(report), [report]);

  if (columns.length === 0) {
    return <p className="text-sm text-muted">需要が設定されていません。</p>;
  }

  return (
    <div className="space-y-2">
      <div className="data-grid-legend" aria-label="凡例">
        {COVERAGE_LEGEND.map(({ label, className }) => (
          <span key={label}>
            <span aria-hidden="true" className={`sw ${className}`} />
            {label}
          </span>
        ))}
      </div>
      <div className="data-grid-wrap">
        <table className="data-grid data-grid-numeric">
          <thead>
            <tr>
              <th scope="col" className="data-grid-rowhead">
                時間
              </th>
              {columns.map((col) => (
                <th
                  key={gridColumnKey(col.trackId, col.roleId)}
                  scope="col"
                  className="data-grid-colhead"
                >
                  {roleById.get(col.roleId)?.name ?? col.roleId}
                  <span className="sub">{trackById.get(col.trackId)?.name ?? col.trackId}</span>
                </th>
              ))}
              <th className="data-grid-filler" />
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot) => (
              <tr key={slot.id}>
                <th scope="row" className="data-grid-rowhead">
                  {slot.start}–{slot.end}
                </th>
                {columns.map((col) => {
                  const key = demandKey(slot.id, col.trackId, col.roleId);
                  const demand = demands.get(key);
                  const current = membersByCell.get(key)?.length ?? 0;
                  const cellReport = reportByCell.get(key);
                  return (
                    <td key={gridColumnKey(col.trackId, col.roleId)}>
                      <button
                        type="button"
                        onClick={() => onSelectCell(col.trackId, col.roleId, [slot.id])}
                        aria-label={coverageLabel(demand, current, cellReport)}
                        className={`data-grid-cell ${coverageClass(demand, current, cellReport)}`}
                      >
                        {demand ? (
                          <>
                            <span className="font-bold tabular-nums">
                              {current}/{demand.ideal}
                            </span>
                            {demand.leadMin > 0 ? (
                              <span className="note">
                                {cellReport?.leadShort
                                  ? `リード${cellReport.leadShort}名不足`
                                  : `リード${demand.leadMin}名充足`}
                              </span>
                            ) : null}
                            {cellReport && cellReport.violations.length > 0 ? (
                              <span className="text-[0.66rem] font-bold text-gdg-red">
                                {VIOLATION_LABELS[cellReport.violations[0]]}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span aria-hidden="true">–</span>
                        )}
                      </button>
                    </td>
                  );
                })}
                <td className="data-grid-filler" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const COVERAGE_LEGEND = [
  { label: "理想を充足", className: "data-grid-cell-ok" },
  { label: "理想に未達", className: "data-grid-cell-under" },
  { label: "リードが不足", className: "data-grid-cell-lead-short" },
  { label: "頭数が不足", className: "data-grid-cell-short" },
] as const;

function coverageClass(
  demand: Demand | undefined,
  current: number,
  cellReport?: CellReport,
): string {
  if (!demand) return "data-grid-cell-empty";
  if ((cellReport?.headcountShort ?? 0) > 0) return "data-grid-cell-short";
  if ((cellReport?.violations.length ?? 0) > 0) return "data-grid-cell-warn";
  if ((cellReport?.leadShort ?? 0) > 0) return "data-grid-cell-lead-short";
  if (current >= demand.ideal) return "data-grid-cell-ok";
  return "data-grid-cell-under";
}

function coverageLabel(
  demand: Demand | undefined,
  current: number,
  cellReport?: CellReport,
): string {
  if (!demand) return "需要なし";
  const parts = [`現在${current}名 / 理想${demand.ideal}名`];
  if (cellReport?.headcountShort) parts.push(`頭数${cellReport.headcountShort}名不足`);
  if (cellReport?.leadShort) parts.push(`経験者${cellReport.leadShort}名不足`);
  for (const v of cellReport?.violations ?? []) parts.push(VIOLATION_LABELS[v]);
  return parts.join("、");
}
