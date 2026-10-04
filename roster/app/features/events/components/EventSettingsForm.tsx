import { Form } from "react-router";
import type { EventRecord } from "~/features/events/events.server";
import { STATUSES, STATUS_LABELS } from "~/features/events/status";

export const STEP_OPTIONS = [15, 30, 60] as const;
const MAX_CONSECUTIVE_OPTIONS = [3, 4, 5, 6] as const;

/**
 * The "イベント設定" card on `/e/:id/design`
 * (docs/roster/02-domain-schema.md "Design" §6): step size, status, the
 * consecutive-slot cap, and the solo-newcomer rule. Not in the stage doc's
 * `Files to touch` list verbatim (it only names `EventCard.tsx` /
 * `EventForm.tsx`) — split out because EventCard is the list-page summary
 * and EventForm is the creation form, neither of which fits an in-place
 * settings-edit form; see the PR description for this deviation.
 *
 * Name / date / start / end aren't editable here — changing the step size
 * is the only lever exposed for schedule regeneration in this stage's UI
 * (the design doc's settings card lists exactly these four fields).
 *
 * `demandLossByStepMin` (docs/roster/03-demand-input.md "Design" §6, Stage
 * 03) is `~/features/demand/impact#demandLossByStepMinOption`'s output,
 * precomputed by the route from data it already loaded. Submitting a
 * `stepMin` that would lose demand rows is gated by a native `confirm()` —
 * this is the one real place the warning has to appear "保存前に", not a
 * separate preview elsewhere on the page. Defaults to `{}` so this
 * component still works standalone (e.g. in a future test) without a
 * caller that knows about the demand feature.
 */
export function EventSettingsForm({
  event,
  demandLossByStepMin = {},
}: {
  event: EventRecord;
  demandLossByStepMin?: Partial<Record<number, number>>;
}) {
  return (
    <Form
      method="post"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(formEvent) => {
        const form = formEvent.currentTarget;
        const stepMinInput = form.elements.namedItem("stepMin");
        const stepMin =
          stepMinInput instanceof HTMLSelectElement ? Number(stepMinInput.value) : null;
        const lostCount = stepMin === null ? 0 : (demandLossByStepMin[stepMin] ?? 0);
        if (
          lostCount > 0 &&
          !confirm(
            `刻み幅を${stepMin}分に変更すると、${lostCount}件の需要が失われます。続行しますか？`,
          )
        ) {
          formEvent.preventDefault();
        }
      }}
    >
      <input type="hidden" name="intent" value="updateSettings" />

      <label className="block space-y-1">
        <span className="text-sm font-medium">刻み幅</span>
        <select
          name="stepMin"
          defaultValue={event.stepMin}
          className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        >
          {STEP_OPTIONS.map((min) => (
            <option key={min} value={min}>
              {min}分
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">ステータス</span>
        <select
          name="status"
          defaultValue={event.status}
          className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">連続稼働の上限</span>
        <select
          name="maxConsecutive"
          defaultValue={event.maxConsecutive}
          className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        >
          {MAX_CONSECUTIVE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}枠
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">初参加者の単独配置</span>
        <select
          name="noSoloNewcomer"
          defaultValue={event.noSoloNewcomer ? "1" : "0"}
          className="w-full rounded-xl border-2 border-border bg-surface p-3 outline-none focus:ring-4 focus:ring-gdg-blue/40"
        >
          <option value="1">禁止する</option>
          <option value="0">許可する</option>
        </select>
      </label>

      <div className="sm:col-span-2">
        <button
          type="submit"
          className="rounded-full border-2 border-border bg-gdg-blue px-6 py-2.5 font-bold text-primary-foreground transition hover:brightness-95"
        >
          設定を保存
        </button>
      </div>
    </Form>
  );
}
