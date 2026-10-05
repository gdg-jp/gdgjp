export const DEFAULT_NAME = "追加のシフト表";
export const SUPPORTED_STEPS = [15, 30, 60] as const;

export type SheetFormValues = {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  stepMin: string;
  maxConsecutive: string;
  noSoloNewcomer: boolean;
};

export type SheetFormErrors = Partial<Record<keyof SheetFormValues, string>>;

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function parseSheetForm(form: FormData) {
  const values: SheetFormValues = {
    name: formValue(form, "name"),
    date: formValue(form, "date"),
    startTime: formValue(form, "startTime"),
    endTime: formValue(form, "endTime"),
    stepMin: formValue(form, "stepMin"),
    maxConsecutive: formValue(form, "maxConsecutive"),
    noSoloNewcomer: formValue(form, "noSoloNewcomer") === "true",
  };
  const errors: SheetFormErrors = {};
  const name = values.name.trim();
  const stepMin = Number(values.stepMin);
  const maxConsecutive = Number(values.maxConsecutive);

  if (!name || name.length > 100) errors.name = "1〜100文字で入力してください。";
  if (!isValidDate(values.date)) errors.date = "有効な日付を選択してください。";
  if (!isValidTime(values.startTime)) {
    errors.startTime = "有効な開始時刻を入力してください。";
  }
  if (!isValidTime(values.endTime)) {
    errors.endTime = "有効な終了時刻を入力してください。";
  }
  if (isValidTime(values.startTime) && isValidTime(values.endTime)) {
    if (values.startTime >= values.endTime) {
      errors.endTime = "終了時刻は開始時刻より後にしてください。";
    } else if (
      Number.isInteger(stepMin) &&
      SUPPORTED_STEPS.includes(stepMin as (typeof SUPPORTED_STEPS)[number]) &&
      toMinutes(values.endTime) - toMinutes(values.startTime) < stepMin
    ) {
      errors.endTime = "時間の長さは刻み幅以上にしてください。";
    }
  }
  if (!SUPPORTED_STEPS.includes(stepMin as (typeof SUPPORTED_STEPS)[number])) {
    errors.stepMin = "刻み幅を選択してください。";
  }
  if (
    !/^\d+$/.test(values.maxConsecutive) ||
    !Number.isSafeInteger(maxConsecutive) ||
    maxConsecutive < 1
  ) {
    errors.maxConsecutive = "1以上の整数を入力してください。";
  }

  return {
    values,
    errors,
    input: {
      name,
      date: values.date,
      startTime: values.startTime,
      endTime: values.endTime,
      stepMin,
      maxConsecutive,
      noSoloNewcomer: values.noSoloNewcomer,
    },
  };
}

function isValidDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
}

function isValidTime(time: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
