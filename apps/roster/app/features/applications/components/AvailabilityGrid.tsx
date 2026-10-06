import { Button } from "@gdgjp/design-system";
import { useId } from "react";
import {
  type AvailabilityValue,
  UNAVAILABILITY_CHOICES,
  UNAVAILABILITY_HINT,
} from "~/features/applications/types";

export type AvailabilityGridSlot = {
  id: string;
  start: string;
  end: string;
  phaseName: string | null;
};

export type AvailabilityRosterSheet = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  timeSlots: AvailabilityGridSlot[];
};

/**
 * The grid's bulk shortcuts. "すべて解除" clears every mark; the half-day
 * shortcuts add × to their half and keep the other half's current answers.
 */
export function availabilityShortcuts(
  values: Readonly<Record<string, AvailabilityValue>>,
): { label: string; compute: (slot: AvailabilityGridSlot) => AvailabilityValue }[] {
  const current = (slot: AvailabilityGridSlot) => values[slot.id] ?? "o";
  return [
    { label: "すべて解除", compute: () => "o" },
    { label: "午前は不可", compute: (slot) => (slot.start < "12:00" ? "x" : current(slot)) },
    { label: "午後は不可", compute: (slot) => (slot.start >= "12:00" ? "x" : current(slot)) },
  ];
}

/**
 * The "参加できない時間" picker over an event's time slots
 * (docs/roster/04-applications.md "Design" §2). Staff mark only the slots they
 * cannot (×) or would rather not (△) work; every unmarked slot is submitted
 * as `o`. Each slot posts one hidden `avail_<slotId>` input (`form-fields.ts`),
 * so the saved o/d/x rows and the solver are unchanged by this input style.
 *
 * Shortcut buttons exist because marking a 10+ slot event by hand is the
 * input-load problem the stage doc calls out (`availabilityShortcuts`).
 *
 * The △ caveat (`UNAVAILABILITY_HINT`) stays visible per the stage doc's
 * warning that leaving it unsaid makes everyone answer △ and breaks the
 * solver's cost model.
 */
export function AvailabilityGrid({
  timeSlots,
  values,
  onChange,
  onBulkChange,
}: {
  timeSlots: readonly AvailabilityGridSlot[];
  values: Readonly<Record<string, AvailabilityValue>>;
  onChange: (timeSlotId: string, value: AvailabilityValue) => void;
  onBulkChange: (compute: (slot: AvailabilityGridSlot) => AvailabilityValue) => void;
}) {
  const hintId = useId();

  if (timeSlots.length === 0) {
    return (
      <output className="text-sm text-muted">このシフト表には選択できる時間枠がありません。</output>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {availabilityShortcuts(values).map((shortcut) => (
          <ShortcutButton
            key={shortcut.label}
            label={shortcut.label}
            onClick={() => onBulkChange(shortcut.compute)}
          />
        ))}
      </div>

      <div id={hintId} className="space-y-1 text-xs text-muted">
        <p>参加できない時間だけ選んでください。選ばなかった時間は参加できるものとして扱います。</p>
        <p>{UNAVAILABILITY_HINT}</p>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {timeSlots.map((slot) => {
          const value = values[slot.id] ?? "o";
          return (
            <li key={slot.id} className="px-3 py-2">
              <fieldset
                aria-describedby={hintId}
                className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3"
              >
                <legend className="sr-only">
                  {slot.start}–{slot.end}
                  {slot.phaseName ? ` ${slot.phaseName}` : ""}
                </legend>
                <span aria-hidden="true">
                  <span className="text-sm font-medium tabular-nums">
                    {slot.start}–{slot.end}
                  </span>
                  {slot.phaseName ? (
                    <span className="ml-2 text-sm text-muted">{slot.phaseName}</span>
                  ) : null}
                </span>
                <input type="hidden" name={`avail_${slot.id}`} value={value} />
                <div className="grid w-full grid-cols-2 gap-0.5 rounded-md bg-background p-0.5 sm:inline-flex sm:w-auto">
                  {UNAVAILABILITY_CHOICES.map((choice) => {
                    const checked = value === choice.value;
                    return (
                      <label
                        key={choice.value}
                        className={`availability-option cursor-pointer whitespace-nowrap rounded-sm px-2 py-1 text-center text-xs font-semibold transition sm:px-3 sm:text-sm ${
                          checked
                            ? choice.value === "x"
                              ? "bg-danger/10 text-danger ring-1 ring-danger/50"
                              : "bg-warning/10 text-warning ring-1 ring-warning/50"
                            : "text-muted hover:text-foreground"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            onChange(slot.id, event.target.checked ? choice.value : "o")
                          }
                          className="sr-only"
                        />
                        {choice.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShortcutButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="min-h-11">
      {label}
    </Button>
  );
}
