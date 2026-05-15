import { and, count, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  await requireRole(request, env, "admin");
  const db = getDb(env);

  const [userCount, pageStats, bilingualCount] = await Promise.all([
    db.select({ total: count() }).from(schema.user).get(),
    db
      .select({
        total: count(),
        published: sql<number>`count(case when ${schema.pages.status} = 'published' then 1 end)`,
        drafts: sql<number>`count(case when ${schema.pages.status} = 'draft' then 1 end)`,
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
  ]);

  const totalPages = pageStats?.total ?? 0;
  const bilingualPages = bilingualCount?.total ?? 0;
  const bilingualPct = totalPages > 0 ? Math.round((bilingualPages / totalPages) * 100) : 0;

  return {
    totalUsers: userCount?.total ?? 0,
    totalPages,
    publishedPages: pageStats?.published ?? 0,
    draftPages: pageStats?.drafts ?? 0,
    bilingualPct,
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
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-4xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function AdminStats() {
  const { totalUsers, totalPages, publishedPages, draftPages, bilingualPct } =
    useLoaderData<typeof loader>();
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t("admin.stats.heading")}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("admin.stats.total_users")} value={totalUsers} />
        <StatCard
          label={t("admin.stats.total_pages")}
          value={totalPages}
          sub={t("admin.stats.pages_sub", { published: publishedPages, drafts: draftPages })}
        />
        <StatCard label={t("admin.stats.published")} value={publishedPages} />
        <StatCard
          label={t("admin.stats.bilingual_coverage")}
          value={`${bilingualPct}%`}
          sub={t("admin.stats.bilingual_coverage_sub")}
        />
      </div>
    </div>
  );
}
