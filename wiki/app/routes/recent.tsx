import { and, desc, eq, inArray } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { buildVisibilityFilter } from "~/lib/page-visibility.server";
import { timeAgo } from "~/lib/time";

export const meta: MetaFunction = () => [{ title: "Recent — GDG Japan Wiki" }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const visFilter = buildVisibilityFilter(user, identity.chapterIds);

  const [recentUpdated, recentViewed] = await Promise.all([
    db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        summaryJa: schema.pages.summaryJa,
        summaryEn: schema.pages.summaryEn,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .where(and(eq(schema.pages.status, "published"), visFilter))
      .orderBy(desc(schema.pages.updatedAt))
      .limit(12)
      .all(),

    db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        summaryJa: schema.pages.summaryJa,
        summaryEn: schema.pages.summaryEn,
        updatedAt: schema.pages.updatedAt,
        viewedAt: schema.pageViews.viewedAt,
      })
      .from(schema.pageViews)
      .innerJoin(schema.pages, eq(schema.pageViews.pageId, schema.pages.id))
      .where(
        and(eq(schema.pageViews.userId, user.id), eq(schema.pages.status, "published"), visFilter),
      )
      .orderBy(desc(schema.pageViews.viewedAt))
      .limit(12)
      .all(),
  ]);

  // Batch-fetch tags for all pages in both lists
  type PageTag = {
    pageId: string;
    tagSlug: string;
    labelJa: string;
    labelEn: string;
    color: string;
  };
  let pageTags: PageTag[] = [];
  const allIds = [
    ...new Set([...recentUpdated.map((p) => p.id), ...recentViewed.map((p) => p.id)]),
  ];
  if (allIds.length > 0) {
    pageTags = await db
      .select({
        pageId: schema.pageTags.pageId,
        tagSlug: schema.pageTags.tagSlug,
        labelJa: schema.tags.labelJa,
        labelEn: schema.tags.labelEn,
        color: schema.tags.color,
      })
      .from(schema.pageTags)
      .innerJoin(schema.tags, eq(schema.pageTags.tagSlug, schema.tags.slug))
      .where(inArray(schema.pageTags.pageId, allIds))
      .all();
  }

  const tagsByPage = new Map<string, PageTag[]>();
  for (const pt of pageTags) {
    const arr = tagsByPage.get(pt.pageId) ?? [];
    arr.push(pt);
    tagsByPage.set(pt.pageId, arr);
  }

  return {
    recentUpdated: recentUpdated.map((p) => ({ ...p, tags: tagsByPage.get(p.id) ?? [] })),
    recentViewed: recentViewed.map((p) => ({ ...p, tags: tagsByPage.get(p.id) ?? [] })),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PageCard = {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  summaryJa: string;
  summaryEn: string;
  tags: { tagSlug: string; labelJa: string; labelEn: string; color: string }[];
  timeLabel: string | null;
};

function PageGrid({ pages, emptyKey }: { pages: PageCard[]; emptyKey: string }) {
  const { t, i18n } = useTranslation();
  const isJa = i18n.language !== "en";

  if (pages.length === 0) {
    return <p className="text-sm text-gray-400">{t(emptyKey)}</p>;
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="inline-grid grid-rows-2 grid-flow-col auto-cols-[260px] gap-4">
        {pages.map((page) => (
          <Link
            key={page.id}
            to={`/wiki/${page.slug}`}
            className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-500/40 hover:shadow-sm"
          >
            <h3 className="line-clamp-2 font-medium text-gray-900">
              {isJa ? page.titleJa || page.titleEn : page.titleEn || page.titleJa}
            </h3>

            {(page.summaryEn || page.summaryJa) && (
              <p className="line-clamp-2 text-sm text-gray-500">
                {isJa ? page.summaryJa || page.summaryEn : page.summaryEn || page.summaryJa}
              </p>
            )}

            <div className="mt-auto flex flex-wrap gap-1 pt-1">
              {page.tags.map((tag) => (
                <span
                  key={tag.tagSlug}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  {isJa ? tag.labelJa : tag.labelEn}
                </span>
              ))}
            </div>

            {page.timeLabel && <time className="text-xs text-gray-400">{page.timeLabel}</time>}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function RecentPage() {
  const { recentUpdated, recentViewed } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  const updatedCards: PageCard[] = recentUpdated.map((p) => ({
    ...p,
    timeLabel: p.updatedAt ? timeAgo(new Date(p.updatedAt), t) : null,
  }));

  const viewedCards: PageCard[] = recentViewed.map((p) => ({
    ...p,
    timeLabel: p.viewedAt ? timeAgo(new Date(p.viewedAt), t) : null,
  }));

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-8 text-2xl font-bold text-gray-900">{t("recent.title")}</h1>

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("recent.recently_viewed")}</h2>
        <PageGrid pages={viewedCards} emptyKey="recent.no_viewed" />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("recent.recently_updated")}</h2>
        <PageGrid pages={updatedCards} emptyKey="recent.no_updated" />
      </section>
    </div>
  );
}
