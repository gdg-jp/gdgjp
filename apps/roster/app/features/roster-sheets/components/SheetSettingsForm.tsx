import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  Checkbox,
  FormField,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@gdgjp/design-system";
import { useRef, useState } from "react";
import { Form } from "react-router";
import {
  type SlotDataLossImpact,
  type SlotRowCounts,
  slotDataLossOnSlotChange,
} from "~/features/demand/impact";
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
  availabilityCounts,
  assignmentCounts,
}: {
  sheet: RosterSheet;
  phases: Phase[];
  timeSlots: TimeSlot[];
  demands: Demand[];
  availabilityCounts: SlotRowCounts;
  assignmentCounts: SlotRowCounts;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedSubmission = useRef(false);
  const [pendingImpact, setPendingImpact] = useState<SlotDataLossImpact | null>(null);

  return (
    <>
      <Form
        ref={formRef}
        method="post"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          if (confirmedSubmission.current) {
            confirmedSubmission.current = false;
            return;
          }

          const form = event.currentTarget;
          const formData = new FormData(form);
          const confirmationInput = form.elements.namedItem(
            "slotDataLossConfirmation",
          ) as HTMLInputElement | null;
          if (confirmationInput) confirmationInput.value = "";
          const startTime = String(formData.get("startTime") ?? "");
          const endTime = String(formData.get("endTime") ?? "");
          const stepMin = Number(formData.get("stepMin"));
          if (
            !validTime(startTime) ||
            !validTime(endTime) ||
            startTime >= endTime ||
            !STEPS.includes(stepMin as (typeof STEPS)[number])
          )
            return;
          const next = buildSlots({ start: startTime, end: endTime, stepMin }, phases);
          const impact = slotDataLossOnSlotChange(
            timeSlots,
            next,
            demands,
            availabilityCounts,
            assignmentCounts,
          );
          if (!impact.hasLoss) return;

          event.preventDefault();
          setPendingImpact(impact);
        }}
      >
        <input type="hidden" name="intent" value="updateSettings" />
        <input type="hidden" name="sheetId" value={sheet.id} />
        <input type="hidden" name="slotDataLossConfirmation" value="" />
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
      <AlertDialog
        open={pendingImpact !== null}
        onOpenChange={(open) => {
          if (!open) setPendingImpact(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>時間枠の設定変更を確認</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingImpact ? (
              <>
                時間枠の設定を変更すると、次のデータが失われます。
                <br />
                需要 {pendingImpact.lostDemandCount} 件、スタッフの希望{" "}
                {pendingImpact.lostAvailabilityCount} 件、 割当 {pendingImpact.lostAssignmentCount}{" "}
                件
              </>
            ) : null}
          </AlertDialogDescription>
          <div className="flex justify-end gap-3">
            <AlertDialogCancel asChild>
              <Button variant="outline">キャンセル</Button>
            </AlertDialogCancel>
            <AlertDialogAction
              asChild
              onClick={() => {
                if (!pendingImpact || !formRef.current) return;
                const confirmationInput = formRef.current.elements.namedItem(
                  "slotDataLossConfirmation",
                ) as HTMLInputElement | null;
                if (confirmationInput) confirmationInput.value = pendingImpact.confirmationKey;
                confirmedSubmission.current = true;
                formRef.current.requestSubmit();
              }}
            >
              <Button variant="danger">設定を変更する</Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
