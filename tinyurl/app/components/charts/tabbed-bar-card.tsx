import { type ReactNode, useState } from "react";
import { BarList, type BarTone } from "~/components/charts/bar-list";
import { Card } from "~/components/ui/card";
import type { TopRow } from "~/lib/analytics-engine";
import { cn } from "~/lib/utils";

export type BarTab = {
  key: string;
  label: string;
  rows: TopRow[];
  emptyLabel?: string;
  renderIcon?: (row: TopRow) => ReactNode;
  pending?: boolean;
  selectedKey?: string;
  onSelect?: (row: TopRow) => void;
};

export function TabbedBarCard({
  tabs,
  tone = "blue",
  meta = "CLICKS",
}: {
  tabs: BarTab[];
  tone?: BarTone;
  meta?: string;
}) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!current) return null;
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-3 border-b px-5 pt-4">
        <div role="tablist" className="flex items-center gap-3 text-sm">
          {tabs.map((tab) => {
            const isActive = tab.key === current.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`${tab.key}-tab`}
                aria-selected={isActive}
                aria-controls={`${tab.key}-panel`}
                onClick={() => setActive(tab.key)}
                className={cn(
                  "relative pb-3 font-medium transition-colors",
                  isActive
                    ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground after:content-['']"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <span className="pb-3 text-[10px] font-medium tracking-wider text-muted-foreground">
          {meta}
        </span>
      </div>
      <div id={`${current.key}-panel`} className="px-5 py-4">
        <BarList
          rows={current.rows}
          emptyLabel={current.emptyLabel}
          tone={tone}
          renderIcon={current.renderIcon}
          height={272}
          pending={current.pending}
          selectedKey={current.selectedKey}
          onSelect={current.onSelect}
        />
      </div>
    </Card>
  );
}
