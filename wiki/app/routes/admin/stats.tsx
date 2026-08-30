import { and, count, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireAdmin } from "~/features/auth/utils.server";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireAdmin(request, env);
  const db = getDb(env);

  const [userCount, pageStats, bilingualCount, translationStats] = await Promise.all([
    db.select({ total: count() }).from(schema.user).get(),
    db
      .select({
        total: count(),
        published: sql<number>`count(case when ${schema.pages.status} = 'published' then 1 end)`,
      })
      .from(schema.pages)
      .get(),
    db
      .select({ total: count() })
      .from(schema.pages)
      .where(
        and(
          ne(schema.pages.translationStatusJa, "missing"),
          ne(schema.pages.translationStatusEn, "missing"),
        ),
      )
      .get(),
    (env.DB as D1Database)
      .prepare(
        `SELECT
         count(CASE WHEN status = 'pending' THEN 1 END) AS pending,
         count(CASE WHEN status IN ('queued', 'processing') THEN 1 END) AS processing,
         count(CASE WHEN status = 'failed' THEN 1 END) AS failed,
         min(CASE WHEN status = 'pending' THEN requested_at END) AS oldestPendingAt,
         count(CASE WHEN status = 'completed' AND completed_at >= unixepoch('now', 'start of day')
                    THEN 1 END) AS completedToday,
         coalesce(sum(cache_hits), 0) AS cacheHits,
         coalesce(sum(cache_misses), 0) AS cacheMisses
       FROM translation_jobs`,
      )
      .first<{
        pending: number;
        processing: number;
        failed: number;
        oldestPendingAt: number | null;
        completedToday: number;
        cacheHits: number;
        cacheMisses: number;
      }>(),
  ]);

  const totalPages = pageStats?.total ?? 0;
  const bilingualPages = bilingualCount?.total ?? 0;
  const bilingualPct = totalPages > 0 ? Math.round((bilingualPages / totalPages) * 100) : 0;
  const cacheTotal = (translationStats?.cacheHits ?? 0) + (translationStats?.cacheMisses ?? 0);

  return {
    totalUsers: userCount?.total ?? 0,
    totalPages,
    publishedPages: pageStats?.published ?? 0,
    bilingualPct,
    translation: {
      pending: translationStats?.pending ?? 0,
      processing: translationStats?.processing ?? 0,
      failed: translationStats?.failed ?? 0,
      completedToday: translationStats?.completedToday ?? 0,
      oldestPendingAt: translationStats?.oldestPendingAt
        ? new Date(translationStats.oldestPendingAt * 1_000).toISOString()
        : null,
      cacheHitPct:
        cacheTotal > 0 ? Math.round(((translationStats?.cacheHits ?? 0) / cacheTotal) * 100) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-raised p-6">
      <p className="text-sm font-medium text-content-tertiary">{label}</p>
      <p className="mt-2 text-4xl font-bold text-content-primary">{value}</p>
      {sub && <p className="mt-1 text-xs text-content-disabled">{sub}</p>}
    </div>
  );
}

export default function AdminStats() {
  const { totalUsers, totalPages, publishedPages, bilingualPct, translation } =
    useLoaderData<typeof loader>();
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-content-primary">{t("admin.stats.heading")}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("admin.stats.total_users")} value={totalUsers} />
        <StatCard
          label={t("admin.stats.total_pages")}
          value={totalPages}
          sub={t("admin.stats.pages_sub", { published: publishedPages })}
        />
        <StatCard label={t("admin.stats.published")} value={publishedPages} />
        <StatCard
          label={t("admin.stats.bilingual_coverage")}
          value={`${bilingualPct}%`}
          sub={t("admin.stats.bilingual_coverage_sub")}
        />
      </div>

      <h2 className="mb-4 mt-10 text-xl font-bold text-content-primary">
        {t("admin.stats.translation_heading")}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("admin.stats.translation_pending")}
          value={translation.pending}
          sub={
            translation.oldestPendingAt
              ? t("admin.stats.translation_oldest", {
                  date: new Date(translation.oldestPendingAt).toLocaleString(),
                })
              : undefined
          }
        />
        <StatCard
          label={t("admin.stats.translation_processing")}
          value={translation.processing}
          sub={t("admin.stats.translation_failed", { count: translation.failed })}
        />
        <StatCard
          label={t("admin.stats.translation_completed_today")}
          value={translation.completedToday}
        />
        <StatCard
          label={t("admin.stats.translation_cache_hit_rate")}
          value={`${translation.cacheHitPct}%`}
        />
      </div>
    </div>
  );
}
