import { Card, FormField, IconButton, Icons, NativeSelect, Stack } from "@gdgjp/design-system";
import { type ReactNode, useMemo, useState } from "react";
import { SlotPillGrid } from "~/features/scheduling/components/slot-pill-grid";
import {
  DAY_LABELS,
  type DayRanges,
  MEETING_LENGTH_OPTIONS,
  TIME_OPTIONS,
  type TimeRange,
  generateSlotTimes,
  isValidTime,
  minutesToTime,
  timeToMinutes,
} from "~/features/scheduling/slots";

const DEFAULT_DAYS: DayRanges[] = Array.from({ length: 7 }, (_, i) => ({
  ranges: i < 5 ? [{ start: "19:00", end: "22:00" }] : [],
}));

export type ScheduleEditorProps = {
  initialMinutes?: number;
  initialDays?: DayRanges[];
  children?: ReactNode;
};

export function ScheduleEditor({
  initialMinutes = 60,
  initialDays = DEFAULT_DAYS,
  children,
}: ScheduleEditorProps) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [days, setDays] = useState<DayRanges[]>(initialDays);

  const generated = useMemo(() => generateAll(days, minutes), [days, minutes]);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Stack className="gap-6">
        {children}
        <FormField id="slot_minutes" label="Meeting length">
          <NativeSelect
            id="slot_minutes"
            name="slot_minutes"
            value={minutes}
            onChange={(e) => setMinutes(Number.parseInt(e.target.value, 10))}
          >
            {MEETING_LENGTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Weekly availability</p>
          <p className="text-xs text-muted">
            For each day, set the time ranges when meetings could happen. We'll generate the slots
            for you.
          </p>
          <div className="flex flex-col divide-y divide-border/60">
            {days.map((d, i) => (
              <DayRow
                key={DAY_LABELS[i]}
                day={i}
                state={d}
                onChange={(next) => setDays((prev) => prev.map((row, j) => (i === j ? next : row)))}
              />
            ))}
          </div>
        </div>
      </Stack>

      <div className="md:sticky md:top-24 md:self-start">
        <PreviewGrid generated={generated} minutes={minutes} />
      </div>
    </div>
  );
}

function DayRow({
  day,
  state,
  onChange,
}: {
  day: number;
  state: DayRanges;
  onChange: (next: DayRanges) => void;
}) {
  const addRange = () => {
    const last = state.ranges[state.ranges.length - 1];
    const next = last ? nextRangeAfter(last) : { start: "09:00", end: "17:00" };
    onChange({ ranges: [...state.ranges, next] });
  };
  const removeRange = (k: number) => {
    onChange({ ranges: state.ranges.filter((_, j) => j !== k) });
  };
  const updateRange = (k: number, patch: Partial<TimeRange>) => {
    onChange({
      ranges: state.ranges.map((r, j) => (j === k ? { ...r, ...patch } : r)),
    });
  };

  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-2 py-3">
      <span className="pt-1.5 text-sm font-medium text-foreground">{DAY_LABELS[day]}</span>
      <div className="flex flex-col gap-1.5">
        {state.ranges.length === 0 ? (
          <span className="pt-1.5 text-sm text-muted">Unavailable</span>
        ) : (
          state.ranges.map((r, k) => (
            <RangeRow
              // biome-ignore lint/suspicious/noArrayIndexKey: ranges have no stable identity
              key={k}
              day={day}
              range={r}
              onChange={(patch) => updateRange(k, patch)}
              onRemove={() => removeRange(k)}
            />
          ))
        )}
      </div>
      <IconButton
        variant="ghost"
        onClick={addRange}
        aria-label={`Add time range for ${DAY_LABELS[day]}`}
      >
        <Icons name="Plus" size={16} animateOnHover={false} />
      </IconButton>
    </div>
  );
}

function RangeRow({
  day,
  range,
  onChange,
  onRemove,
}: {
  day: number;
  range: TimeRange;
  onChange: (patch: Partial<TimeRange>) => void;
  onRemove: () => void;
}) {
  const invalid =
    isValidTime(range.start) &&
    isValidTime(range.end) &&
    timeToMinutes(range.end) <= timeToMinutes(range.start);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TimeSelect
        name={`day_${day}_start`}
        value={range.start}
        onChange={(v) => onChange({ start: v })}
        invalid={invalid}
        aria-label={`${DAY_LABELS[day]} start time`}
      />
      <span className="text-sm text-muted">–</span>
      <TimeSelect
        name={`day_${day}_end`}
        value={range.end}
        onChange={(v) => onChange({ end: v })}
        invalid={invalid}
        aria-label={`${DAY_LABELS[day]} end time`}
      />
      <IconButton
        variant="ghost"
        onClick={onRemove}
        aria-label={`Remove time range for ${DAY_LABELS[day]}`}
      >
        <Icons name="X" size={16} animateOnHover={false} />
      </IconButton>
    </div>
  );
}

function TimeSelect({
  name,
  value,
  onChange,
  invalid,
  ...rest
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
} & Omit<React.ComponentProps<"select">, "value" | "onChange" | "name">) {
  const includesValue = TIME_OPTIONS.includes(value);
  return (
    <NativeSelect
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      className="tabular-nums"
      {...rest}
    >
      {!includesValue && <option value={value}>{value}</option>}
      {TIME_OPTIONS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </NativeSelect>
  );
}

function nextRangeAfter(prev: TimeRange): TimeRange {
  if (!isValidTime(prev.end)) return { start: "09:00", end: "17:00" };
  const startMin = Math.min(timeToMinutes(prev.end), 23 * 60);
  const endMin = Math.min(startMin + 60, 23 * 60 + 45);
  return { start: minutesToTime(startMin), end: minutesToTime(endMin) };
}

function PreviewGrid({
  generated,
  minutes,
}: {
  generated: { day: number; time: string }[];
  minutes: number;
}) {
  const usedDays = useMemo(() => {
    const seen = new Set(generated.map((g) => g.day));
    return [...seen].sort((a, b) => a - b);
  }, [generated]);
  const allTimes = useMemo(() => {
    const seen = new Set(generated.map((g) => g.time));
    return [...seen].sort();
  }, [generated]);
  const slotByDayTime = useMemo(() => {
    const map = new Map<string, { dayOfWeek: number; startTime: string }>();
    for (const g of generated) {
      map.set(`${g.day}-${g.time}`, { dayOfWeek: g.day, startTime: g.time });
    }
    return map;
  }, [generated]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Preview</p>
        <p className="text-xs text-muted">
          {generated.length} slot{generated.length === 1 ? "" : "s"} ({minutes} min each)
        </p>
      </div>
      {generated.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted">
          Add a time range to see the slots.
        </p>
      ) : (
        <Card className="p-3">
          <SlotPillGrid
            mode="preview"
            usedDays={usedDays}
            allTimes={allTimes}
            slotByDayTime={slotByDayTime}
          />
        </Card>
      )}
    </div>
  );
}

function generateAll(days: DayRanges[], minutes: number): { day: number; time: string }[] {
  const out: { day: number; time: string }[] = [];
  for (let i = 0; i < days.length; i++) {
    const seen = new Set<string>();
    for (const r of days[i].ranges) {
      if (!isValidTime(r.start) || !isValidTime(r.end)) continue;
      if (timeToMinutes(r.end) <= timeToMinutes(r.start)) continue;
      for (const t of generateSlotTimes(r.start, r.end, minutes)) {
        if (seen.has(t)) continue;
        seen.add(t);
        out.push({ day: i, time: t });
      }
    }
  }
  return out;
}
