import type { ReactNode } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import type { TopRow } from "~/lib/analytics-engine";
import { cn } from "~/lib/utils";

export type BarTone = "blue" | "amber" | "rose" | "violet" | "emerald";

const TONE_CLASS: Record<BarTone, string> = {
  blue: "bg-gdg-blue/15",
  amber: "bg-amber-200/60 dark:bg-amber-400/20",
  rose: "bg-rose-200/60 dark:bg-rose-400/20",
  violet: "bg-violet-200/60 dark:bg-violet-400/20",
  emerald: "bg-emerald-200/60 dark:bg-emerald-400/20",
};

export type BarListRow = TopRow & {
  key?: string;
  description?: string | null;
};

export function BarList({
  rows,
  emptyLabel,
  tone = "blue",
  renderIcon,
  height,
  pending = false,
  selectedKey,
  onSelect,
}: {
  rows: BarListRow[];
  emptyLabel?: string;
  tone?: BarTone;
  renderIcon?: (row: BarListRow) => ReactNode;
  height?: number;
  pending?: boolean;
  selectedKey?: string;
  onSelect?: (row: BarListRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{emptyLabel ?? "No data in this range."}</p>
    );
  }
  const max = Math.max(...rows.map((r) => r.clicks), 1);
  return (
    <ul
      className="min-w-0 space-y-1.5 overflow-y-auto pr-1"
      style={height ? { maxHeight: height } : undefined}
      aria-busy={pending || undefined}
    >
      {rows.map((r) => {
        const pct = (r.clicks / max) * 100;
        const rowKey = r.key ?? r.name;
        const content = (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {renderIcon ? (
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {renderIcon(r)}
                </span>
              ) : null}
              <span className="min-w-0 truncate" title={r.name}>
                {r.name}
              </span>
              {r.description ? (
                <span
                  className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground"
                  title={r.description}
                >
                  {r.description}
                </span>
              ) : null}
            </span>
            {pending ? (
              <Skeleton className="h-4 w-8 shrink-0" />
            ) : (
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {r.clicks.toLocaleString()}
              </span>
            )}
          </>
        );
        return (
          <li key={rowKey} className="relative">
            <div
              className={`absolute inset-y-0 left-0 rounded ${TONE_CLASS[tone]}`}
              style={{ width: pending ? "0%" : `${pct}%` }}
              aria-hidden
            />
            {onSelect ? (
              <button
                type="button"
                disabled={pending}
                aria-pressed={selectedKey === rowKey}
                onClick={() => onSelect(r)}
                className={cn(
                  "relative flex min-w-0 w-full cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none",
                  selectedKey === rowKey && "bg-accent ring-1 ring-ring/30",
                )}
              >
                {content}
              </button>
            ) : (
              <div className="relative flex min-w-0 items-center justify-between gap-3 px-2 py-1.5 text-sm">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
