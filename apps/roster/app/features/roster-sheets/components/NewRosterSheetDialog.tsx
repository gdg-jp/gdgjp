import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  FormField,
  Icons,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@gdgjp/design-system";
import { useEffect, useRef, useState } from "react";
import { Form } from "react-router";
import { SUPPORTED_STEPS, type SheetFormErrors, type SheetFormValues } from "../sheet-form";

export function NewRosterSheetDialog({
  values,
  errors,
  formError,
  submitting,
  sheetCount,
}: {
  values: SheetFormValues;
  errors: SheetFormErrors;
  formError?: string;
  submitting: boolean;
  sheetCount: number;
}) {
  const [open, setOpen] = useState(Boolean(formError || Object.keys(errors).length));
  const previousSheetCount = useRef(sheetCount);

  useEffect(() => {
    if (sheetCount > previousSheetCount.current) setOpen(false);
    previousSheetCount.current = sheetCount;
  }, [sheetCount]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <Icons name="Plus" size={18} aria-hidden="true" />
          シフト表を追加
        </Button>
      </DialogTrigger>
      <DialogContent className="new-sheet-dialog overflow-y-auto">
        <DialogTitle>シフト表を追加</DialogTitle>
        <DialogDescription>
          日付と時間を設定して作成します。役割や必要人数は作成後に設定できます。
        </DialogDescription>
        {formError && (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Form method="post" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="createSheet" />
          <FormField id="sheet-name" label="シフト表名" error={errors.name} required>
            <Input
              name="name"
              defaultValue={values.name}
              maxLength={100}
              required
              autoComplete="off"
            />
          </FormField>
          <FormField id="sheet-date" label="開催日" error={errors.date} required>
            <Input name="date" type="date" defaultValue={values.date} required />
          </FormField>
          <FormField id="sheet-start" label="開始時刻" error={errors.startTime} required>
            <Input name="startTime" type="time" defaultValue={values.startTime} required />
          </FormField>
          <FormField id="sheet-end" label="終了時刻" error={errors.endTime} required>
            <Input name="endTime" type="time" defaultValue={values.endTime} required />
          </FormField>
          <details
            open={Boolean(errors.stepMin || errors.maxConsecutive)}
            className="sm:col-span-2"
          >
            <summary className="cursor-pointer font-medium">詳細設定</summary>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="sheet-step" label="時間枠の刻み幅" error={errors.stepMin} required>
                <NativeSelect name="stepMin" defaultValue={values.stepMin} required>
                  <NativeSelectOption value="">選択してください</NativeSelectOption>
                  {values.stepMin &&
                    !SUPPORTED_STEPS.some((step) => String(step) === values.stepMin) && (
                      <NativeSelectOption value={values.stepMin}>
                        {values.stepMin}分（選択できません）
                      </NativeSelectOption>
                    )}
                  {SUPPORTED_STEPS.map((step) => (
                    <NativeSelectOption key={step} value={step}>
                      {step}分
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField
                id="sheet-max-consecutive"
                label="連続担当の上限"
                error={errors.maxConsecutive}
                required
              >
                <Input
                  name="maxConsecutive"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={values.maxConsecutive}
                  required
                />
              </FormField>
              <FormField id="sheet-no-solo" label="新人を単独の時間枠に割り当てない">
                <Checkbox
                  name="noSoloNewcomer"
                  value="true"
                  defaultChecked={values.noSoloNewcomer}
                />
              </FormField>
            </div>
          </details>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={submitting}>
              シフト表を作成
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
