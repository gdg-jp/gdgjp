import { Card, PageHeader } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { requireAdmin } from "~/features/auth/utils.server";
import { summarizeLatency } from "~/features/observability/freshness.server";
import { getDb } from "~/lib/db.server";

export const meta: MetaFunction = () => [{ title: "Stats — GDG Japan Wiki" }];

/** /admin/stats — 7-day p50 / p95 of freshness, integration and answer latency (Stage 06). */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  return { summaries: await summarizeLatency(getDb(env)) };
}

function formatSeconds(value: number | null): string {
  if (value === null) return "—";
  if (value < 120) return `${value}s`;
  if (value < 7200) return `${Math.round(value / 60)}m`;
  return `${(value / 3600).toFixed(1)}h`;
}

export default function AdminStatsPage() {
  const { summaries } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("admin.stats.title")} description={t("admin.stats.description")} />
      <div className="grid gap-3 sm:grid-cols-2">
        {summaries.map((row) => (
          <Card key={row.kind} className="flex flex-col gap-1 p-4 text-sm">
            <span className="font-medium text-foreground">{t(`admin.stats.kind.${row.kind}`)}</span>
            {row.kind === "answer_expired" ? (
              <span className="text-muted">
                {t("admin.stats.rate", {
                  rate: row.mean === null ? "—" : `${Math.round(row.mean * 100)}%`,
                  count: row.count,
                })}
              </span>
            ) : (
              <span className="text-muted">
                {t("admin.stats.percentiles", {
                  p50: formatSeconds(row.p50),
                  p95: formatSeconds(row.p95),
                  count: row.count,
                })}
              </span>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
