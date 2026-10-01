import { Form } from "react-router";
import type { Phase, TimeSlot } from "~/features/schedule/schedule.server";

/**
 * The "フェーズと時間枠の一覧" card on `/e/:id/design`
 * (docs/roster/02-domain-schema.md "Design" §6). Phases are created/deleted
 * here; the resulting time-slot grid is read-only — it's derived by
 * `regenerateTimeSlots` from the event's start/end/step and this phase list,
 * never edited directly.
 */
export function PhaseList({
  phases,
  timeSlots,
  sheetId,
}: { phases: Phase[]; timeSlots: TimeSlot[]; sheetId: string }) {
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="font-bold">フェーズ</h3>
        {phases.length === 0 ? (
          <p className="text-sm text-neutral-600">フェーズはまだありません。</p>
        ) : (
          <ul className="space-y-2">
            {phases.map((phase) => (
              <li
                key={phase.id}
                className="flex items-center justify-between gap-3 rounded-xl border-2 border-black bg-white p-3"
              >
                <span>
                  <span className="font-medium">{phase.name}</span>{" "}
                  <span className="text-sm text-neutral-500">
                    {phase.from}–{phase.to}
                  </span>
                </span>
                <Form method="post">
                  <input type="hidden" name="intent" value="deletePhase" />
                  <input type="hidden" name="phaseId" value={phase.id} />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <button type="submit" className="text-sm font-medium text-gdg-red underline">
                    削除
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}

        <Form method="post" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="createPhase" />
          <input type="hidden" name="sheetId" value={sheetId} />
          <label className="space-y-1">
            <span className="block text-sm font-medium">名前</span>
            <input
              name="name"
              required
              maxLength={40}
              placeholder="開場前"
              className="rounded-xl border-2 border-black bg-white p-2 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">開始</span>
            <input
              name="from"
              type="time"
              required
              className="rounded-xl border-2 border-black bg-white p-2 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">終了</span>
            <input
              name="to"
              type="time"
              required
              className="rounded-xl border-2 border-black bg-white p-2 outline-none focus:ring-4 focus:ring-gdg-blue/40"
            />
          </label>
          <button
            type="submit"
            className="rounded-full border-2 border-black bg-white px-4 py-2 font-bold transition hover:bg-neutral-100"
          >
            フェーズを追加
          </button>
        </Form>
      </div>

      <div className="space-y-3">
        <h3 className="font-bold">時間枠（{timeSlots.length}）</h3>
        {timeSlots.length === 0 ? (
          <p className="text-sm text-neutral-600">時間枠がありません。</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {timeSlots.map((slot) => (
              <li key={slot.id} className="rounded-xl border-2 border-black bg-white p-2 text-sm">
                <span className="font-medium">
                  {slot.start}–{slot.end}
                </span>
                {slot.phaseId ? (
                  <span className="block text-neutral-500">{phaseName.get(slot.phaseId)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
