import { motion } from "motion/react";
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
  const { usedDays, allTimes } = props;
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
            if (props.mode === "preview") {
              const slot = props.slotByDayTime.get(key);
              return slot ? <PreviewPill key={key} time={time} /> : <EmptyCell key={key} />;
            }
            const slot = props.slotByDayTime.get(key);
            if (!slot) return <EmptyCell key={key} />;
            const count = props.totals.get(slot.id) ?? 0;
            return (
              <label key={key} className="block cursor-pointer">
                <input
                  type="checkbox"
                  name="slot_id"
                  value={slot.id}
                  defaultChecked={props.ownSet.has(slot.id)}
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
                    "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
                  )}
                >
                  {time}
                  {props.totalParticipants > 0 && count > 0 ? (
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
