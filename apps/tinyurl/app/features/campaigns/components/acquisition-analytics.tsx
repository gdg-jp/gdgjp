import { Card, Icons, Stack } from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  ACQUISITION_PERIOD_PARAMS,
  type PeriodPreset,
} from "~/features/analytics/analytics-filters";
import { AnalyticsDateButton } from "~/features/analytics/components/analytics/analytics-date-button";
import { AnalyticsGraphInterval } from "~/features/analytics/components/analytics/analytics-graph-interval";
import { AnalyticsTrendChart } from "~/features/analytics/components/charts/analytics-trend-chart";
import type { CampaignAcquisitionAnalytics } from "~/features/campaigns/campaign-acquisition";
import type { CampaignParticipantAnalyticsSnapshot } from "~/features/campaigns/campaign-participant-analytics-db";

const COLORS = [
  "var(--gdg-blue)",
  "var(--gdg-red)",
  "var(--gdg-yellow)",
  "var(--gdg-green)",
  "var(--gdg-primary)",
  "var(--gdg-secondary)",
];

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
          <Icons name="ChartPie" aria-hidden="true" className="mx-auto size-9 text-muted" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Acquisition</h2>
            <p className="text-sm text-muted">
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
          <Stack>
            <div className="gap-1">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm">Acquisition summary</h2>
                {importControl}
              </div>
              <p className="text-xs">connpass {snapshot.connpassEventId}</p>
            </div>
            <div className="min-w-0">
              <dl className="divide-y text-sm">
                <div className="flex items-center justify-between gap-4 py-2 first:pt-0">
                  <dt className="text-muted">Applications</dt>
                  <dd className="font-mono font-medium tabular-nums">
                    {analytics.summary.applications.toLocaleString()}
                  </dd>
                </div>
                {analytics.summary.participationTypes.map((participationType) => (
                  <div
                    key={participationType.name}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <dt className="min-w-0 truncate text-muted" title={participationType.name}>
                      {participationType.name}
                    </dt>
                    <dd className="font-mono tabular-nums">
                      {participationType.count.toLocaleString()}
                    </dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-4 py-2">
                  <dt className="text-muted">Cancellations</dt>
                  <dd className="font-mono font-medium tabular-nums">
                    {analytics.summary.cancellations.toLocaleString()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-2">
                  <dt className="text-muted">Attendance rate</dt>
                  <dd className="font-mono font-medium tabular-nums">
                    {percentage(analytics.summary.attendanceRate)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 pt-2">
                  <dt className="text-muted">CSV updated</dt>
                  <dd className="text-right text-xs">{formatUpdatedAt(snapshot.updatedAt)}</dd>
                </div>
              </dl>
            </div>
          </Stack>
        </Card>

        <Card className="min-w-0">
          <Stack>
            <div className="gap-1">
              <h2 className="text-sm">Acquisition channels</h2>
              <p className="text-xs">
                Non-cancelled applications; multi-select answers count for each channel.
              </p>
            </div>
            <div className="space-y-2 px-3 sm:px-6">
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
                <div className="flex h-[230px] items-center justify-center text-sm text-muted">
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
            </div>
          </Stack>
        </Card>
      </div>

      <Card className="min-w-0">
        <Stack>
          <div className="gap-1">
            <h2 className="text-sm">Acquisition over time</h2>
            <p className="text-xs">Non-cancelled applications by registration period.</p>
          </div>
          <div className="min-w-0 px-3 sm:px-6">
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
          </div>
        </Stack>
      </Card>
    </section>
  );
}
