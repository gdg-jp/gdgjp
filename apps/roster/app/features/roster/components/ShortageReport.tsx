import type { ReactNode } from "react";
import type { Report, Shortage, Violation } from "~/features/solver/types";
import { VIOLATION_LABELS } from "../grid";

const MAX_ITEMS = 8;

type NameMaps = {
  slotLabelById: ReadonlyMap<string, string>;
  trackNameById: ReadonlyMap<string, string>;
  roleNameById: ReadonlyMap<string, string>;
};

function locationLabel(
  { slotId, trackId, roleId }: { slotId: string; trackId: string; roleId: string },
  maps: NameMaps,
): string {
  const slot = maps.slotLabelById.get(slotId) ?? slotId;
  const track = maps.trackNameById.get(trackId) ?? trackId;
  const role = maps.roleNameById.get(roleId) ?? roleId;
  return `${slot} · ${track} / ${role}`;
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <h3 className="font-bold">{title}</h3>
      {children}
    </div>
  );
}

function capped<T>(items: readonly T[]): { shown: T[]; restCount: number } {
  return { shown: items.slice(0, MAX_ITEMS), restCount: Math.max(0, items.length - MAX_ITEMS) };
}

/**
 * The 3-column shortage/violation breakdown below `MetricsRow`
 * (docs/roster/07-roster-manual-edit.md "Design" §4, §5.8 in index.md):
 * headcount shortage, lead (experience) shortage, and skill-mix violations
 * (`newcomerOver` / `soloNewcomer` — `over` is excluded here, it's an
 * "ideal exceeded" note from manual edits, not one of the 3 recruiting-
 * relevant columns the stage doc lists). Deliberately never renders
 * "解なし" — the whole point of this report is to say WHAT is short
 * instead (index.md §5.8).
 */
export function ShortageReport({ report, ...maps }: { report: Report } & NameMaps) {
  const headcount = report.shortages.filter((s): s is Shortage => s.kind === "headcount");
  const lead = report.shortages.filter((s): s is Shortage => s.kind === "lead");
  const skillMix = report.violations.filter(
    (v): v is Violation => v.kind === "newcomerOver" || v.kind === "soloNewcomer",
  );

  if (headcount.length === 0 && lead.length === 0 && skillMix.length === 0) {
    return (
      <p className="rounded-xl border-2 border-border bg-surface p-3 text-sm font-bold text-gdg-blue">
        不足・違反はありません。
      </p>
    );
  }

  const headcountCapped = capped(headcount);
  const leadCapped = capped(lead);
  const skillMixCapped = capped(skillMix);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Column title={`頭数の不足（${headcount.length}）`}>
        <ShortageList
          items={headcountCapped.shown}
          maps={maps}
          restCount={headcountCapped.restCount}
        />
      </Column>
      <Column title={`経験者の不足（${lead.length}）`}>
        <ul className="space-y-2 text-sm">
          {leadCapped.shown.map((s) => (
            <li key={`${s.slotId}:${s.trackId}:${s.roleId}`}>
              <p>
                {locationLabel(s, maps)} — {s.amount}名不足
              </p>
            </li>
          ))}
        </ul>
        {leadCapped.restCount > 0 ? (
          <p className="text-xs text-neutral-500">ほか{leadCapped.restCount}件</p>
        ) : null}
      </Column>
      <Column title={`経験構成の違反（${skillMix.length}）`}>
        <ul className="space-y-2 text-sm">
          {skillMixCapped.shown.map((v) => (
            <li key={`${v.slotId}:${v.trackId}:${v.roleId}:${v.kind}`}>
              <p>
                {locationLabel(v, maps)} — {VIOLATION_LABELS[v.kind]}
              </p>
            </li>
          ))}
        </ul>
        {skillMixCapped.restCount > 0 ? (
          <p className="text-xs text-neutral-500">ほか{skillMixCapped.restCount}件</p>
        ) : null}
      </Column>
    </div>
  );
}

function ShortageList({
  items,
  maps,
  restCount,
}: {
  items: readonly Shortage[];
  maps: NameMaps;
  restCount: number;
}) {
  return (
    <>
      <ul className="space-y-1 text-sm">
        {items.map((s) => (
          <li key={`${s.slotId}:${s.trackId}:${s.roleId}`}>
            {locationLabel(s, maps)} — {s.amount}名不足
          </li>
        ))}
      </ul>
      {restCount > 0 ? <p className="text-xs text-neutral-500">ほか{restCount}件</p> : null}
    </>
  );
}
