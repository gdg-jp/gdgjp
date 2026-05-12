import { useMemo, useState } from "react";
import {
  DAY_LABELS,
  MEETING_LENGTH_OPTIONS,
  generateSlotTimes,
  isValidTime,
  timeToMinutes,
} from "~/lib/slots";
import { cn } from "~/lib/utils";

type DayState = { enabled: boolean; start: string; end: string };

const INITIAL_DAYS: DayState[] = Array.from({ length: 7 }, (_, i) => ({
  enabled: i < 5,
  start: "19:00",
  end: "22:00",
}));

export function ScheduleEditor() {
  const [minutes, setMinutes] = useState(60);
  const [days, setDays] = useState<DayState[]>(INITIAL_DAYS);

  const generated = useMemo(() => generateAll(days, minutes), [days, minutes]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="slot_minutes" className="text-sm font-medium">
          Meeting length
        </label>
        <select
          id="slot_minutes"
          name="slot_minutes"
          value={minutes}
          onChange={(e) => setMinutes(Number.parseInt(e.target.value, 10))}
          className={cn(
            "h-9 w-fit rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          )}
        >
          {MEETING_LENGTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Weekly availability</p>
        <p className="text-xs text-muted-foreground">
          For each day, set the time range when meetings could happen. We'll generate the slots for
          you.
        </p>
        <div className="flex flex-col">
          {days.map((d, i) => (
            <DayRow
              key={DAY_LABELS[i]}
              day={i}
              state={d}
              onChange={(patch) =>
                setDays((prev) => prev.map((row, j) => (i === j ? { ...row, ...patch } : row)))
              }
            />
          ))}
        </div>
      </div>

      <PreviewGrid generated={generated} minutes={minutes} />
    </div>
  );
}

function DayRow({
  day,
  state,
  onChange,
}: {
  day: number;
  state: DayState;
  onChange: (patch: Partial<DayState>) => void;
}) {
  const invalid =
    state.enabled &&
    isValidTime(state.start) &&
    isValidTime(state.end) &&
    timeToMinutes(state.end) <= timeToMinutes(state.start);
  return (
    <div className="grid grid-cols-[auto_3rem_1fr_auto_1fr] items-center gap-2 py-1.5">
      <input
        type="checkbox"
        aria-label={`Enable ${DAY_LABELS[day]}`}
        checked={state.enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
        className="size-4"
      />
      <span
        className={cn(
          "text-sm font-medium",
          state.enabled ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {DAY_LABELS[day]}
      </span>
      <input
        type="time"
        name={state.enabled ? `day_${day}_start` : undefined}
        value={state.start}
        onChange={(e) => onChange({ start: e.target.value })}
        disabled={!state.enabled}
        required={state.enabled}
        className={cn(
          "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:opacity-50",
          invalid && "border-destructive",
        )}
      />
      <span className="text-sm text-muted-foreground">–</span>
      <input
        type="time"
        name={state.enabled ? `day_${day}_end` : undefined}
        value={state.end}
        onChange={(e) => onChange({ end: e.target.value })}
        disabled={!state.enabled}
        required={state.enabled}
        className={cn(
          "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:opacity-50",
          invalid && "border-destructive",
        )}
      />
    </div>
  );
}

function PreviewGrid({
  generated,
  minutes,
}: {
  generated: { day: number; time: string }[];
  minutes: number;
}) {
  const enabledDays = useMemo(() => {
    const seen = new Set(generated.map((g) => g.day));
    return [...seen].sort((a, b) => a - b);
  }, [generated]);
  const allTimes = useMemo(() => {
    const seen = new Set(generated.map((g) => g.time));
    return [...seen].sort();
  }, [generated]);
  const set = useMemo(() => new Set(generated.map((g) => `${g.day}-${g.time}`)), [generated]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Preview</p>
        <p className="text-xs text-muted-foreground">
          {generated.length} slot{generated.length === 1 ? "" : "s"} ({minutes} min each)
        </p>
      </div>
      {generated.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Enable a day and pick a time range to see the slots.
        </p>
      ) : (
        <div
          className="grid gap-1 rounded-md border p-3 text-sm"
          style={{ gridTemplateColumns: `4rem repeat(${enabledDays.length}, minmax(0, 1fr))` }}
        >
          <div />
          {enabledDays.map((d) => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground">
              {DAY_LABELS[d]}
            </div>
          ))}
          {allTimes.map((time) => (
            <Row key={time} time={time} days={enabledDays} set={set} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  time,
  days,
  set,
}: {
  time: string;
  days: number[];
  set: Set<string>;
}) {
  return (
    <>
      <div className="text-right text-xs text-muted-foreground tabular-nums">{time}</div>
      {days.map((d) => (
        <div
          key={d}
          className={cn(
            "rounded-sm py-0.5 text-center text-xs tabular-nums",
            set.has(`${d}-${time}`) ? "bg-primary/10 text-primary" : "text-muted-foreground/30",
          )}
        >
          {set.has(`${d}-${time}`) ? time : "—"}
        </div>
      ))}
    </>
  );
}

function generateAll(days: DayState[], minutes: number): { day: number; time: string }[] {
  const out: { day: number; time: string }[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (!d.enabled) continue;
    if (!isValidTime(d.start) || !isValidTime(d.end)) continue;
    if (timeToMinutes(d.end) <= timeToMinutes(d.start)) continue;
    for (const t of generateSlotTimes(d.start, d.end, minutes)) {
      out.push({ day: i, time: t });
    }
  }
  return out;
}
