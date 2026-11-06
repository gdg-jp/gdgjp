import { Badge, Card, EmptyState, PageHeader } from "@gdgjp/design-system";
import { desc, sql } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { requireAdmin } from "~/features/auth/utils.server";
import { getDb } from "~/lib/db.server";

export const meta: MetaFunction = () => [{ title: "Runner — GDG Japan Wiki" }];

/** /admin/runner — is the OCI runner alive, and what is waiting for it. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  const db = getDb(env);
  const [runners, counts, recent, rateLimited] = await Promise.all([
    db.select().from(schema.runnerStatus).all(),
    db
      .select({
        type: schema.agentJobs.type,
        status: schema.agentJobs.status,
        count: sql<number>`count(*)`,
        oldest: sql<number | null>`min(${schema.agentJobs.createdAt})`,
      })
      .from(schema.agentJobs)
      .groupBy(schema.agentJobs.type, schema.agentJobs.status)
      .all(),
    db.select().from(schema.agentJobs).orderBy(desc(schema.agentJobs.createdAt)).limit(50).all(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.agentJobs)
      .where(
        sql`${schema.agentJobs.status} = 'failed' AND ${schema.agentJobs.error} LIKE '%rate%' AND ${schema.agentJobs.finishedAt} > unixepoch() - 86400`,
      )
      .get(),
  ]);
  return {
    runners: runners.map((runner) => ({
      ...runner,
      lastSeenAt: runner.lastSeenAt.toISOString(),
      staleMinutes: Math.floor((Date.now() - runner.lastSeenAt.getTime()) / 60000),
    })),
    counts,
    rateLimited24h: rateLimited?.n ?? 0,
    recent: recent.map((job) => ({
      id: job.id,
      type: job.type,
      spaceId: job.spaceId,
      status: job.status,
      attempts: job.attempts,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      error: job.error,
    })),
  };
}

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  queued: "info",
  leased: "warning",
  succeeded: "success",
  failed: "danger",
  needs_review: "warning",
  expired: "neutral",
};

export default function AdminRunnerPage() {
  const { runners, counts, recent, rateLimited24h } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("admin.runner.title")} description={t("admin.runner.description")} />
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">{t("admin.runner.hosts")}</h2>
        {runners.length === 0 ? (
          <EmptyState title={t("admin.runner.no_hosts")} />
        ) : (
          runners.map((runner) => (
            <Card
              key={runner.host}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <span className="font-medium text-foreground">{runner.host}</span>
              <span className="text-muted">
                {runner.backend} {runner.version} · {runner.runningJobId ?? "idle"}
              </span>
              <Badge tone={runner.staleMinutes > 10 ? "danger" : "success"}>
                {t("admin.runner.last_seen", { minutes: runner.staleMinutes })}
              </Badge>
            </Card>
          ))
        )}
        <p className="text-sm text-muted">
          {t("admin.runner.rate_limited", { count: rateLimited24h })}
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">{t("admin.runner.queue")}</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {counts.map((row) => (
            <li key={`${row.type}-${row.status}`}>
              <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
                {row.type} · {row.status}: {row.count}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">{t("admin.runner.recent")}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {recent.map((job) => (
            <li key={job.id} className="flex flex-wrap gap-2 border-b border-border py-1">
              <Badge tone={STATUS_TONE[job.status] ?? "neutral"}>{job.status}</Badge>
              <span className="text-foreground">{job.type}</span>
              <span className="text-muted">{job.spaceId}</span>
              <span className="text-muted">{job.createdAt}</span>
              {job.error ? <span className="truncate text-danger">{job.error}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
