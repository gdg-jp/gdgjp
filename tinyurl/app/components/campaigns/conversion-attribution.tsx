import { TrendingUp } from "lucide-react";
import { BarList } from "~/components/charts/bar-list";
import { MetricCard } from "~/components/charts/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import type { CampaignConversionAttribution } from "~/lib/campaign-conversion-attribution";

function decimal(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function percent(value: number): string {
  return `${decimal(value)}%`;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function CampaignConversionAttributionPanel({
  analytics,
}: {
  analytics: CampaignConversionAttribution | null;
}) {
  return (
    <section className="space-y-3" aria-label="Conversion attribution">
      {analytics ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              title="Registrations"
              value={analytics.registrations}
              hint="Non-cancelled registrations in this Analytics range"
            />
            <MetricCard
              title="Attributed registrations"
              value={decimal(analytics.attributedRegistrations)}
              hint={`${percent(analytics.attributionPercent)} had a click in the prior 24 hours`}
            />
            <MetricCard
              title="Estimated click conversion"
              value={percent(analytics.conversionRate)}
              hint="Attributed registrations ÷ clicks"
            />
          </div>

          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(16rem,0.8fr)]">
            <Card className="min-w-0">
              <CardHeader className="gap-1">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingUp className="size-4 text-gdg-blue" /> Channel conversion contribution
                </CardTitle>
                <CardDescription className="text-xs">
                  Estimated from each registration&apos;s preceding 24-hour Channel click share ·
                  connpass {analytics.connpassEventId} · Updated{" "}
                  {formatUpdatedAt(analytics.updatedAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto px-4 sm:px-6">
                {analytics.channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No Channel clicks are available in this range.
                  </p>
                ) : (
                  <table className="w-full min-w-[38rem] text-sm">
                    <thead className="border-b text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="pb-2 font-medium">Channel</th>
                        <th className="pb-2 text-right font-medium">Clicks</th>
                        <th className="pb-2 text-right font-medium">Est. registrations</th>
                        <th className="pb-2 text-right font-medium">Contribution</th>
                        <th className="pb-2 text-right font-medium">Conversion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {analytics.channels.map((channel) => (
                        <tr key={channel.channelId}>
                          <td className="py-2.5 font-medium">{channel.name}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums">
                            {channel.clicks.toLocaleString()}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums">
                            {decimal(channel.estimatedRegistrations)}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums">
                            {percent(channel.contributionPercent)}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums">
                            {percent(channel.conversionRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="gap-1">
                <CardTitle className="text-sm">Discovery channels</CardTitle>
                <CardDescription className="text-xs">
                  Secondary context from the connpass questionnaire.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 sm:px-6">
                <BarList
                  rows={analytics.discoveryChannels.map((item) => ({
                    name: item.name,
                    clicks: item.count,
                  }))}
                  emptyLabel="No discovery-channel responses."
                  height={250}
                />
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">
            Import a connpass CSV to add registration conversion attribution to this Analytics view.
          </CardContent>
        </Card>
      )}
    </section>
  );
}
