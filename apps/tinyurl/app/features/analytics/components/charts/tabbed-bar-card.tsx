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
}: {
  tabs: BarTab[];
  tone?: BarTone;
}) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!current) return null;
  return (
    <Card className="min-w-0 p-0">
      <Tabs value={current.key} onValueChange={setActive}>
        <Stack className="gap-0">
          <div className="flex min-w-0 items-center border-b px-5 pt-2">
            <TabsList
              className="min-w-0 flex-nowrap overflow-x-auto"
              aria-label="Analytics breakdown"
            >
              {tabs.map((tab) => (
                <TabsTrigger
                  className="min-h-8 shrink-0 whitespace-nowrap px-2 py-1 pointer-coarse:min-h-11"
                  key={tab.key}
                  value={tab.key}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
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
