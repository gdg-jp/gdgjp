import { useMemo, useState } from "react";
import { buildPersonTimeline } from "../timeline";
import type { PublicAssignment } from "../types";

export type PersonTimelineSlot = { id: string; idx: number; start: string; end: string };
type TrackInfo = { name: string; color: string };
type StaffOption = { id: string; name: string };

export function PersonTimeline({
  staff,
  timeSlots,
  assignments,
  trackById,
  roleNameById,
  nameById,
  matchedIds,
}: {
  staff: readonly StaffOption[];
  timeSlots: readonly PersonTimelineSlot[];
  assignments: readonly PublicAssignment[];
  trackById: ReadonlyMap<string, TrackInfo>;
  roleNameById: ReadonlyMap<string, string>;
  nameById: ReadonlyMap<string, string>;
  matchedIds?: ReadonlySet<string>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const sortedStaff = useMemo(
    () => [...staff].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [staff],
  );

  const soleMatch = matchedIds?.size === 1 ? [...matchedIds][0] : undefined;
  const [lastSoleMatch, setLastSoleMatch] = useState<string | undefined>(undefined);
  if (soleMatch !== lastSoleMatch) {
    setLastSoleMatch(soleMatch);
    if (soleMatch && soleMatch !== selectedId) setSelectedId(soleMatch);
  }
  const items = useMemo(
    () => (selectedId ? buildPersonTimeline(timeSlots, assignments, selectedId) : []),
    [selectedId, timeSlots, assignments],
  );

  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="block font-medium">スタッフを選択</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full rounded-xl border-2 border-border bg-surface p-3 text-base outline-none focus:ring-4 focus:ring-gdg-blue/40"
        >
          <option value="">選択してください</option>
          {sortedStaff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {selectedId ? (
        items.length === 0 ? (
          <p className="text-sm text-neutral-600">担当はありません。</p>
        ) : (
          <ol className="space-y-3">
            {items.map((item) => {
              if (item.kind === "break") {
                return (
                  <li
                    key={item.start}
                    className="rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4"
                  >
                    <div className="font-bold">
                      {item.start}–{item.end}
                    </div>
                    <div className="text-sm text-neutral-600">休憩 / 担当なし</div>
                  </li>
                );
              }
              const track = trackById.get(item.trackId);
              return (
                <li
                  key={item.start}
                  className="rounded-xl border-2 border-border bg-surface p-4"
                  style={
                    track ? { borderLeftWidth: "8px", borderLeftColor: track.color } : undefined
                  }
                >
                  <div className="font-bold">
                    {item.start}–{item.end}
                  </div>
                  <div className="text-sm">
                    {roleNameById.get(item.roleId) ?? item.roleId}
                    {track ? `（${track.name}）` : ""}
                  </div>
                  <div className="mt-1 text-sm text-neutral-600">
                    {item.companionIds.length === 0
                      ? "この枠はひとりです"
                      : `一緒に: ${item.companionIds.map((id) => nameById.get(id) ?? id).join("、")}`}
                  </div>
                </li>
              );
            })}
          </ol>
        )
      ) : null}
    </div>
  );
}
