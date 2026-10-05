import { useEffect, useRef } from "react";
import { Form } from "react-router";
import { LEVEL_LABELS, type Level } from "~/features/applications/types";
import type { SuggestionCategory } from "~/features/solver/suggest";
import type { Demand } from "~/features/solver/types";

export type DemandCellSelection = {
  trackId: string;
  roleId: string;
  trackName: string;
  roleName: string;
  slotIds: string[];
  /** e.g. "10:00–11:00" for one slot, or "10:00–11:30" for a merged range. */
  label: string;
};

export type DemandSuggestion = {
  applicationId: string;
  name: string;
  category: SuggestionCategory;
  pref: 1 | 2 | 3;
  level: Level | undefined;
  warnings: string[];
  /** ○/△/× across the whole event's time slots, in slot order — index.md §5's day-long picture, not just this cell's range. */
  availabilityPattern: string;
  /** How many slots this person is already assigned to today (fairness context for the owner). */
  loadCount: number;
};

const CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  "free-o": "空き（○）",
  "free-d": "空き（△）",
  busy: "この時間帯は別の担当あり",
  unavailable: "稼働不可",
};

/**
 * The demand-cell editor (docs/roster/07-roster-manual-edit.md "Design"
 * §5b): "その (時間枠 × トラック × 役割) に誰を入れるか." Clicking a merged
 * `RoleGrid` range opens this with every slot in that range — "add" places
 * the chosen candidate into ALL of them via one `intent=assign` submit
 * carrying repeated `slotId` fields ("一括で配置する...1枠ずつクリックさせ
 * ない"), never one request per slot.
 *
 * Suggestions come from `grid.ts#suggestForRange`, already sorted
 * free-○ → free-△ → busy → unavailable, tie-broken by preference — this
 * component only renders that order, it never re-sorts by its own notion
 * of desirability.
 */
export function DemandCellDrawer({
  selection,
  demand,
  currentOccupants,
  suggestions,
  error,
  succeeded,
  onClose,
}: {
  selection: DemandCellSelection | null;
  demand: Demand | null;
  currentOccupants: readonly { applicationId: string; name: string; level?: Level }[];
  suggestions: readonly DemandSuggestion[];
  error?: string;
  /** A fresh truthy value only on a successful assign/unassign — see `StaffDrawer`'s identical contract. */
  succeeded: unknown;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
      aria-labelledby="demand-cell-drawer-title"
      className="roster-drawer"
    >
      {selection ? (
        <div className="max-h-[85vh] space-y-4 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-500">{selection.label}</p>
              <h3 id="demand-cell-drawer-title" className="text-lg font-bold">
                {selection.trackName} / {selection.roleName}
              </h3>
              {selection.slotIds.length > 1 ? (
                <p className="text-xs text-neutral-500">
                  {selection.slotIds.length}枠に一括で配置します
                </p>
              ) : null}
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

          {demand ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-background px-2.5 py-1 font-semibold">
                人数 {currentOccupants.length} / 理想 {demand.ideal}（最小 {demand.min}）
              </span>
              {demand.leadMin > 0 ? (
                <span className="rounded-full bg-background px-2.5 py-1 font-semibold">
                  リード {currentOccupants.filter((person) => person.level === "lead").length} /{" "}
                  {demand.leadMin}
                </span>
              ) : null}
              {demand.newMax < 99 ? (
                <span className="rounded-full bg-background px-2.5 py-1 font-semibold">
                  初参加 {currentOccupants.filter((person) => person.level === "new").length} / 上限{" "}
                  {demand.newMax}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <h4 className="text-sm font-bold">現在の担当</h4>
            {currentOccupants.length === 0 ? (
              <p className="text-sm text-neutral-500">まだ誰も割り当てられていません。</p>
            ) : (
              <ul className="space-y-1">
                {currentOccupants.map((o) => (
                  <li
                    key={o.applicationId}
                    className="flex items-center justify-between rounded-xl border-2 border-border bg-neutral-50 p-2"
                  >
                    <span className="text-sm">{o.name}</span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="unassign" />
                      <input type="hidden" name="applicationId" value={o.applicationId} />
                      {selection.slotIds.map((id) => (
                        <input key={id} type="hidden" name="slotId" value={id} />
                      ))}
                      <button type="submit" className="text-xs font-medium text-gdg-red underline">
                        外す
                      </button>
                    </Form>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-bold">ここに入れられる人</h4>
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.applicationId} className="rounded-xl border-2 border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold">
                        {s.name}
                        {s.pref === 1 ? (
                          <span className="ml-1 text-xs font-bold text-gdg-blue">第1希望</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {s.level ? LEVEL_LABELS[s.level] : "スキル登録なし"} ・{" "}
                        {CATEGORY_LABELS[s.category]} ・ 本日{s.loadCount}枠
                      </p>
                      <p className="font-mono text-xs text-neutral-500">{s.availabilityPattern}</p>
                    </div>
                    <Form method="post">
                      <input type="hidden" name="intent" value="assign" />
                      <input type="hidden" name="applicationId" value={s.applicationId} />
                      <input type="hidden" name="trackId" value={selection.trackId} />
                      <input type="hidden" name="roleId" value={selection.roleId} />
                      {selection.slotIds.map((id) => (
                        <input key={id} type="hidden" name="slotId" value={id} />
                      ))}
                      <button
                        type="submit"
                        className="rounded-full border-2 border-border bg-gdg-blue px-3 py-1 text-xs font-bold text-primary-foreground transition hover:brightness-95"
                      >
                        追加
                      </button>
                    </Form>
                  </div>
                  {s.warnings.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-xs text-gdg-red">
                      {s.warnings.map((w) => (
                        <li key={w}>⚠ {w}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
