import type { AvailabilityValue } from "~/features/applications/types";
import type { ApplyFormRosterSheet } from "./ApplyForm";
import { AvailabilityGrid, type AvailabilityGridSlot } from "./AvailabilityGrid";

export function getAvailabilitySheets(
  rosterSheets: readonly ApplyFormRosterSheet[] | undefined,
  timeSlots: readonly AvailabilityGridSlot[] | undefined,
): readonly ApplyFormRosterSheet[] {
  return (
    rosterSheets ?? [
      {
        id: "event",
        name: "",
        date: "",
        startTime: "",
        endTime: "",
        timeSlots: [...(timeSlots ?? [])],
      },
    ]
  );
}

export function availabilitySlots(
  rosterSheets: readonly ApplyFormRosterSheet[] | undefined,
  timeSlots: readonly AvailabilityGridSlot[] | undefined,
): AvailabilityGridSlot[] {
  return getAvailabilitySheets(rosterSheets, timeSlots).flatMap((sheet) => sheet.timeSlots);
}

export function buildAvailabilityState(
  timeSlots: readonly AvailabilityGridSlot[],
  saved: readonly { timeSlotId: string; value: AvailabilityValue }[],
  fallback: AvailabilityValue,
): Record<string, AvailabilityValue> {
  return Object.fromEntries(
    timeSlots.map((slot) => [
      slot.id,
      saved.find((item) => item.timeSlotId === slot.id)?.value ?? fallback,
    ]),
  );
}

export function AvailabilitySheetGrids({
  rosterSheets,
  timeSlots,
  values,
  onChange,
  onBulkChange,
}: {
  rosterSheets?: readonly ApplyFormRosterSheet[];
  timeSlots?: readonly AvailabilityGridSlot[];
  values: Readonly<Record<string, AvailabilityValue>>;
  onChange: (timeSlotId: string, value: AvailabilityValue) => void;
  onBulkChange: (
    sheet: ApplyFormRosterSheet,
    compute: (slot: AvailabilityGridSlot) => AvailabilityValue,
  ) => void;
}) {
  const sheets = getAvailabilitySheets(rosterSheets, timeSlots);

  if (sheets.length === 0) {
    return <output className="text-sm text-muted">回答できるシフト表がありません。</output>;
  }

  return (
    <div className="space-y-5">
      {sheets.map((sheet) => {
        const grid = (
          <AvailabilityGrid
            timeSlots={sheet.timeSlots}
            values={values}
            onChange={onChange}
            onBulkChange={(compute) => onBulkChange(sheet, compute)}
          />
        );

        if (!sheet.name) return <div key={sheet.id}>{grid}</div>;

        return (
          <fieldset key={sheet.id} className="space-y-3 rounded-lg border border-border p-3">
            <legend className="max-w-full px-1 text-sm font-semibold">
              {sheet.name}
              {sheet.date ? ` — ${sheet.date}` : ""}
              {sheet.startTime && sheet.endTime ? ` ${sheet.startTime}–${sheet.endTime}` : ""}
            </legend>
            {grid}
          </fieldset>
        );
      })}
    </div>
  );
}
