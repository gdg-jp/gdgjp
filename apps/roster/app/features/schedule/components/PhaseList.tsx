import { Button, FormField, Input } from "@gdgjp/design-system";
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
          <p className="gdg-muted text-sm">
            フェーズを追加すると、このシフト表の時間枠が作られます。
          </p>
        ) : (
          <ul className="space-y-2">
            {phases.map((phase) => (
              <li
                key={phase.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <span>
                  <span className="font-medium">{phase.name}</span>{" "}
                  <span className="gdg-muted text-sm">
                    {phase.from}–{phase.to}
                  </span>
                </span>
                <Form method="post">
                  <input type="hidden" name="intent" value="deletePhase" />
                  <input type="hidden" name="phaseId" value={phase.id} />
                  <input type="hidden" name="sheetId" value={sheetId} />
                  <Button type="submit" variant="outline" size="sm">
                    削除
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        )}

        <Form method="post" className="phase-create-form grid grid-cols-1 items-end gap-3">
          <input type="hidden" name="intent" value="createPhase" />
          <input type="hidden" name="sheetId" value={sheetId} />
          <FormField label="名前" required>
            <Input name="name" required maxLength={40} placeholder="開場前" />
          </FormField>
          <FormField label="開始" required>
            <Input name="from" type="time" required />
          </FormField>
          <FormField label="終了" required>
            <Input name="to" type="time" required />
          </FormField>
          <Button type="submit" variant="secondary">
            フェーズを追加
          </Button>
        </Form>
      </div>

      <div className="space-y-3">
        <h3 className="font-bold">時間枠（{timeSlots.length}）</h3>
        {timeSlots.length === 0 ? (
          <p className="gdg-muted text-sm">
            フェーズを追加すると、設定した刻み幅で時間枠が作られます。
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {timeSlots.map((slot) => (
              <li key={slot.id} className="rounded-lg border bg-background p-2 text-sm">
                <span className="font-medium">
                  {slot.start}–{slot.end}
                </span>
                {slot.phaseId ? (
                  <span className="gdg-muted block">{phaseName.get(slot.phaseId)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
