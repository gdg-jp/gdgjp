import { Button, Checkbox, FormField, Input, NativeSelect, NativeSelectOption } from "@gdgjp/ui";
import { Form } from "react-router";
import { demandLossOnSlotChange } from "~/features/demand/impact";
import type { Demand } from "~/features/demand/types";
import type { Phase, TimeSlot } from "~/features/schedule/schedule.server";
import { buildSlots } from "~/features/schedule/slots";
import type { RosterSheet } from "../types";

const STEPS = [15, 30, 60] as const;

export function SheetSettingsForm({
  sheet,
  phases,
  timeSlots,
  demands,
}: {
  sheet: RosterSheet;
  phases: Phase[];
  timeSlots: TimeSlot[];
  demands: Demand[];
}) {
  return (
    <Form
      method="post"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const startTime = String(new FormData(form).get("startTime") ?? "");
        const endTime = String(new FormData(form).get("endTime") ?? "");
        const stepMin = Number(new FormData(form).get("stepMin"));
        if (
          !validTime(startTime) ||
          !validTime(endTime) ||
          startTime >= endTime ||
          !STEPS.includes(stepMin as (typeof STEPS)[number])
        )
          return;
        const next = buildSlots({ start: startTime, end: endTime, stepMin }, phases);
        const { lostCount } = demandLossOnSlotChange(timeSlots, next, demands);
        if (
          lostCount > 0 &&
          !confirm(`設定を変更すると、${lostCount}件の需要が失われます。続行しますか？`)
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="intent" value="updateSettings" />
      <input type="hidden" name="sheetId" value={sheet.id} />
      <FormField id="sheet-name-edit" label="シフト表名" required>
        <Input name="name" defaultValue={sheet.name} maxLength={100} required />
      </FormField>
      <FormField id="sheet-date-edit" label="開催日" required>
        <Input name="date" type="date" defaultValue={sheet.date} required />
      </FormField>
      <FormField id="sheet-start-edit" label="開始時刻" required>
        <Input name="startTime" type="time" defaultValue={sheet.startTime} required />
      </FormField>
      <FormField id="sheet-end-edit" label="終了時刻" required>
        <Input name="endTime" type="time" defaultValue={sheet.endTime} required />
      </FormField>
      <FormField id="sheet-step-edit" label="時間枠の刻み幅" required>
        <NativeSelect name="stepMin" defaultValue={String(sheet.stepMin)} required>
          {STEPS.map((step) => (
            <NativeSelectOption key={step} value={step}>
              {step}分
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <FormField id="sheet-max-consecutive-edit" label="連続担当の上限" required>
        <Input
          name="maxConsecutive"
          type="number"
          min={1}
          step={1}
          defaultValue={sheet.maxConsecutive}
          required
        />
      </FormField>
      <FormField id="sheet-no-solo-edit" label="新人を単独の時間枠に割り当てない">
        <Checkbox name="noSoloNewcomer" value="true" defaultChecked={sheet.noSoloNewcomer} />
      </FormField>
      <div className="sm:col-span-2">
        <Button type="submit">シフト表設定を保存</Button>
      </div>
    </Form>
  );
}

function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
