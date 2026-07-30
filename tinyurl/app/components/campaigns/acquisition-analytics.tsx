import { PieChart as PieChartIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AnalyticsDateButton } from "~/components/analytics/analytics-date-button";
import { AnalyticsGraphInterval } from "~/components/analytics/analytics-graph-interval";
import { AnalyticsTrendChart } from "~/components/charts/analytics-trend-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ACQUISITION_PERIOD_PARAMS, type PeriodPreset } from "~/lib/analytics-filters";
import type { CampaignAcquisitionAnalytics } from "~/lib/campaign-acquisition";
import type { CampaignParticipantAnalyticsSnapshot } from "~/lib/campaign-participant-analytics-db";

const COLORS = ["#4285f4", "#ea4335", "#f9ab00", "#34a853", "#a855f7", "#06b6d4"];

function formatUpdatedAt(value: number): string {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value * 1000),
  );
}

function percentage(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function CampaignAcquisitionPanel({
  snapshot,
  analytics,
  preset,
  startIso,
  endIso,
  bucket,
  pending,
  importControl,
}: {
  snapshot: CampaignParticipantAnalyticsSnapshot | null;
  analytics: CampaignAcquisitionAnalytics | null;
  preset: PeriodPreset;
  startIso?: string;
  endIso?: string;
  bucket: string;
  pending: boolean;
  importControl: ReactNode;
}) {
  if (!snapshot || !analytics) {
    return (
      <section
        id="acquisition-panel"
        role="tabpanel"
        aria-labelledby="acquisition-tab"
        className="flex min-h-[28rem] items-center justify-center"
      >
        <div className="max-w-sm space-y-4 text-center">
          <PieChartIcon className="mx-auto size-9 text-muted-foreground" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Acquisition</h2>
            <p className="text-sm text-muted-foreground">
              Import a connpass CSV to see how participants discovered this event.
            </p>
          </div>
          {importControl}
        </div>
      </section>
    );
  }

  return (
    <section
      id="acquisition-panel"
      role="tabpanel"
      aria-labelledby="acquisition-tab"
      className="space-y-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-1 motion-safe:duration-200"
    >
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader className="gap-1">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm">Acquisition summary</CardTitle>
              {importControl}
            </div>
            <CardDescription className="text-xs">
              connpass {snapshot.connpassEventId}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <div className="flex items-center justify-between gap-4 py-2 first:pt-0">
                <dt className="text-muted-foreground">Applications</dt>
                <dd className="font-mono font-medium tabular-nums">
                  {analytics.summary.applications.toLocaleString()}
                </dd>
              </div>
              {analytics.summary.participationTypes.map((participationType) => (
                <div
                  key={participationType.name}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <dt
                    className="min-w-0 truncate text-muted-foreground"
                    title={participationType.name}
                  >
                    {participationType.name}
                  </dt>
                  <dd className="font-mono tabular-nums">
                    {participationType.count.toLocaleString()}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-muted-foreground">Cancellations</dt>
                <dd className="font-mono font-medium tabular-nums">
                  {analytics.summary.cancellations.toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-muted-foreground">Attendance rate</dt>
                <dd className="font-mono font-medium tabular-nums">
                  {percentage(analytics.summary.attendanceRate)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 pt-2">
                <dt className="text-muted-foreground">CSV updated</dt>
                <dd className="text-right text-xs">{formatUpdatedAt(snapshot.updatedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="gap-1">
            <CardTitle className="text-sm">Acquisition channels</CardTitle>
            <CardDescription className="text-xs">
              Non-cancelled applications; multi-select answers count for each channel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-3 sm:px-6">
            {analytics.channels.length > 0 ? (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={analytics.channels}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {analytics.channels.map((channel, index) => (
                      <Cell key={channel.key} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[230px] items-center justify-center text-sm text-muted-foreground">
                No non-cancelled applications in this range.
              </div>
            )}
            <div className="flex justify-end border-t pt-2">
              <AnalyticsDateButton
                preset={preset}
                startIso={startIso}
                endIso={endIso}
                params={ACQUISITION_PERIOD_PARAMS}
                defaultPreset="all"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader className="gap-1">
          <CardTitle className="text-sm">Acquisition over time</CardTitle>
          <CardDescription className="text-xs">
            Non-cancelled applications by registration period.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 px-3 sm:px-6">
          <AnalyticsTrendChart
            points={analytics.points}
            series={analytics.series}
            granularity={analytics.granularity}
            bucketLabel={analytics.bucketLabel}
            summaryControl={
              <AnalyticsGraphInterval
                value={bucket}
                pending={pending}
                paramName="acquisitionBucket"
                defaultUnit="day"
              />
            }
            breakdown="acquisition"
          />
        </CardContent>
      </Card>
    </section>
  );
}
