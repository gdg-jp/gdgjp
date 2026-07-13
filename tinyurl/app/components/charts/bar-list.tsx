import type { ReactNode } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import type { TopRow } from "~/lib/analytics-engine";

export type BarTone = "blue" | "amber" | "rose" | "violet" | "emerald";

const TONE_CLASS: Record<BarTone, string> = {
  blue: "bg-gdg-blue/15",
  amber: "bg-amber-200/60 dark:bg-amber-400/20",
  rose: "bg-rose-200/60 dark:bg-rose-400/20",
  violet: "bg-violet-200/60 dark:bg-violet-400/20",
  emerald: "bg-emerald-200/60 dark:bg-emerald-400/20",
};

export function BarList({
  rows,
  emptyLabel,
  tone = "blue",
  renderIcon,
  height,
  pending = false,
}: {
  rows: TopRow[];
  emptyLabel?: string;
  tone?: BarTone;
  renderIcon?: (row: TopRow) => ReactNode;
  height?: number;
  pending?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{emptyLabel ?? "No data in this range."}</p>
    );
  }
  const max = Math.max(...rows.map((r) => r.clicks), 1);
  return (
    <ul
      className="space-y-1.5 overflow-y-auto pr-1"
      style={height ? { maxHeight: height } : undefined}
      aria-busy={pending || undefined}
    >
      {rows.map((r) => {
        const pct = (r.clicks / max) * 100;
        return (
          <li key={r.name} className="relative">
            <div
              className={`absolute inset-y-0 left-0 rounded ${TONE_CLASS[tone]}`}
              style={{ width: pending ? "0%" : `${pct}%` }}
              aria-hidden
            />
            <div className="relative flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
              <span className="flex min-w-0 items-center gap-2 truncate" title={r.name}>
                {renderIcon ? (
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    {renderIcon(r)}
                  </span>
                ) : null}
                <span className="truncate">{r.name}</span>
              </span>
              {pending ? (
                <Skeleton className="h-4 w-8 shrink-0" />
              ) : (
                <span className="font-mono tabular-nums text-muted-foreground">
                  {r.clicks.toLocaleString()}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
