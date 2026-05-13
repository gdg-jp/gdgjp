import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { DAY_LABELS } from "~/lib/slots";
import { cn } from "~/lib/utils";

type SlotKey = { dayOfWeek: number; startTime: string };
type InteractiveSlot = SlotKey & { id: number };

export type SlotPillGridProps = {
  usedDays: number[];
  allTimes: string[];
} & (
  | {
      mode: "interactive";
      slotByDayTime: Map<string, InteractiveSlot>;
      ownSet: Set<number>;
      totals: Map<number, number>;
      totalParticipants: number;
    }
  | {
      mode: "preview";
      slotByDayTime: Map<string, SlotKey>;
    }
);

export function SlotPillGrid(props: SlotPillGridProps) {
  if (props.mode === "interactive") {
    return <InteractiveGrid {...props} />;
  }
  return <PreviewModeGrid {...props} />;
}

function InteractiveGrid({
  usedDays,
  allTimes,
  slotByDayTime,
  ownSet,
  totals,
  totalParticipants,
}: Extract<SlotPillGridProps, { mode: "interactive" }>) {
  const ownKey = useMemo(() => [...ownSet].sort((a, b) => a - b).join(","), [ownSet]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(ownSet));
  // Resync with server state after submit + redirect re-runs the loader.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownKey captures ownSet content
  useEffect(() => {
    setSelected(new Set(ownSet));
  }, [ownKey]);

  const slotIdsByDay = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const slot of slotByDayTime.values()) {
      const arr = m.get(slot.dayOfWeek);
      if (arr) arr.push(slot.id);
      else m.set(slot.dayOfWeek, [slot.id]);
    }
    return m;
  }, [slotByDayTime]);

  function toggleSlot(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleDay(day: number) {
    const ids = slotIdsByDay.get(day);
    if (!ids || ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const allChecked = ids.every((id) => next.has(id));
      if (allChecked) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto px-1 py-1.5">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${usedDays.length}, minmax(3.5rem, 1fr))` }}
      >
        {usedDays.map((d) => {
          const ids = slotIdsByDay.get(d) ?? [];
          const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
          return (
            <motion.button
              key={`head-${d}`}
              type="button"
              onClick={() => toggleDay(d)}
              aria-pressed={allChecked}
              aria-label={`${allChecked ? "Deselect" : "Select"} all ${DAY_LABELS[d]} slots`}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className={cn(
                "mb-1 flex items-center justify-center rounded-full border px-3 py-1 text-xs font-medium tabular-nums",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                allChecked
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border-primary/30 text-primary hover:bg-primary/5",
              )}
            >
              {DAY_LABELS[d]}
            </motion.button>
          );
        })}
        {allTimes.map((time) =>
          usedDays.map((d) => {
            const key = `${d}-${time}`;
            const slot = slotByDayTime.get(key);
            if (!slot) return <EmptyCell key={key} />;
            const count = totals.get(slot.id) ?? 0;
            const isChecked = selected.has(slot.id);
            return (
              <label key={key} className="block cursor-pointer">
                <input
                  type="checkbox"
                  name="slot_id"
                  value={slot.id}
                  checked={isChecked}
                  onChange={(e) => toggleSlot(slot.id, e.target.checked)}
                  className="peer sr-only"
                />
                <motion.span
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-sm tabular-nums",
                    "border-primary/30 text-primary transition-colors",
                    "hover:bg-primary/5",
                    "peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:border-primary",
                    "peer-checked:hover:bg-primary/90",
                    "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
                  )}
                >
                  {time}
                  {totalParticipants > 0 && count > 0 ? (
                    <span className="text-xs opacity-70">·{count}</span>
                  ) : null}
                </motion.span>
              </label>
            );
          }),
        )}
      </div>
    </div>
  );
}

function PreviewModeGrid({
  usedDays,
  allTimes,
  slotByDayTime,
}: Extract<SlotPillGridProps, { mode: "preview" }>) {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${usedDays.length}, minmax(3.5rem, 1fr))` }}
      >
        {usedDays.map((d) => (
          <div
            key={`head-${d}`}
            className="pb-1 text-center text-xs font-medium text-muted-foreground"
          >
            {DAY_LABELS[d]}
          </div>
        ))}
        {allTimes.map((time) =>
          usedDays.map((d) => {
            const key = `${d}-${time}`;
            const slot = slotByDayTime.get(key);
            return slot ? <PreviewPill key={key} time={time} /> : <EmptyCell key={key} />;
          }),
        )}
      </div>
    </div>
  );
}

function EmptyCell() {
  return (
    <div aria-hidden className="text-center text-sm text-muted-foreground/40">
      —
    </div>
  );
}

function PreviewPill({ time }: { time: string }) {
  return (
    <span className="flex items-center justify-center rounded-full border border-primary/30 px-3 py-1.5 text-sm text-primary tabular-nums">
      {time}
    </span>
  );
}
