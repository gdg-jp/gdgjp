import { Card, Stack, Tabs, TabsContent, TabsList, TabsTrigger } from "@gdgjp/design-system";
import { type ReactNode, useState } from "react";
import type { TopRow } from "~/features/analytics/analytics-engine";
import { BarList, type BarTone } from "~/features/analytics/components/charts/bar-list";
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
      <Tabs value={current.key} onValueChange={setActive}>
        <Stack>
          <div className="flex items-center justify-between gap-3 border-b px-5 pt-4">
            <TabsList aria-label="Analytics breakdown">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <span className="pb-3 text-[10px] font-medium tracking-wider text-muted">{meta}</span>
          </div>
          <TabsContent value={current.key} className="px-5 py-4">
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
          </TabsContent>
        </Stack>
      </Tabs>
    </Card>
  );
}
