import { and, desc, eq, isNull } from "drizzle-orm";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Await, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { CardGridSkeleton } from "~/components/Skeleton";
import * as schema from "~/db/schema";
import { getAccessIdentity } from "~/features/auth/utils.server";
import TagChip from "~/features/pages/components/TagChip";
import { buildVisibilityFilter } from "~/features/pages/visibility.server";
import { wikiPagePath } from "~/features/pages/wiki-page-path";
import { getWikiCanonicalSlugPaths } from "~/features/pages/wiki-page-path.server";
import { getDb } from "~/lib/db.server";
import { timeAgo } from "~/lib/time";
import { HomeCta } from "./_components/HomeCta";

export const meta: MetaFunction<typeof loader> = ({ matches }) => {
  const origin = (matches.find((m) => m.id === "root")?.data as { origin?: string })?.origin ?? "";
  const parentMeta = matches.flatMap((m) => m.meta ?? []);
  return [
    ...parentMeta,
    { title: "GDG Japan Wiki" },
    {
      name: "description",
      content: "AI-powered bilingual knowledge base for GDG Japan chapters.",
    },
    { property: "og:title", content: "GDG Japan Wiki" },
    {
      property: "og:description",
      content:
        "AI-powered bilingual knowledge base for Google Developer Groups Japan chapters. Share chapter know-how, resources, and best practices — all in one place.",
    },
    { property: "og:url", content: `${origin}/` },
    { property: "og:image", content: `${origin}/og-image.png` },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ];
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getAccessIdentity(request, env);
  const { user } = identity;
  const db = getDb(env);
  const visFilter = buildVisibilityFilter(user, identity.chapters);

  if (!user) {
    const publicPages = db
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
      .all()
      .then(async (pages) => {
        const slugPaths = await getWikiCanonicalSlugPaths(
          env,
          pages.map((p) => p.id),
        );
        return pages.map((p) => ({
          ...p,
          wikiPath: wikiPagePath(slugPaths.get(p.id) ?? [p.slug]),
        }));
      });

    return {
      mode: "public" as const,
      publicPages,
    };
  }

  const homeData = Promise.all([
    // 8 most recently updated published pages
    db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .where(and(eq(schema.pages.status, "published"), visFilter))
      .orderBy(desc(schema.pages.updatedAt))
      .limit(8)
      .all(),

    // All tags ordered by popularity
    db
      .select()
      .from(schema.tags)
      .orderBy(desc(schema.tags.pageCount))
      .all(),

    // 6 most recent non-deleted comments with author + page info
    db
      .select({
        commentId: schema.pageComments.id,
        authorName: schema.user.name,
        authorImage: schema.user.image,
        pageId: schema.pages.id,
        pageSlug: schema.pages.slug,
        pageTitleJa: schema.pages.titleJa,
        pageTitleEn: schema.pages.titleEn,
        commentedAt: schema.pageComments.createdAt,
      })
      .from(schema.pageComments)
      .innerJoin(schema.user, eq(schema.pageComments.authorId, schema.user.id))
      .innerJoin(schema.pages, eq(schema.pageComments.pageId, schema.pages.id))
      .where(
        and(isNull(schema.pageComments.deletedAt), eq(schema.pages.status, "published"), visFilter),
      )
      .orderBy(desc(schema.pageComments.createdAt))
      .limit(6)
      .all(),
  ]).then(async ([recentPages, allTags, recentComments]) => {
    const slugPaths = await getWikiCanonicalSlugPaths(env, [
      ...recentPages.map((p) => p.id),
      ...recentComments.map((c) => c.pageId),
    ]);

    return {
      recentPages: recentPages.map((p) => ({
        ...p,
        wikiPath: wikiPagePath(slugPaths.get(p.id) ?? [p.slug]),
      })),
      allTags,
      recentComments: recentComments.map((c) => ({
        ...c,
        wikiPath: wikiPagePath(slugPaths.get(c.pageId) ?? [c.pageSlug]),
      })),
    };
  });

  return {
    mode: "home" as const,
    homeData,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();

  if (data.mode === "public") {
    const isJa = i18n.language !== "en";
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-10">
        <section aria-labelledby="public-pages-heading">
          <div className="mb-8 max-w-2xl">
            <h1
              id="public-pages-heading"
              className="text-2xl font-bold tracking-tight text-content-primary md:text-3xl"
            >
              {t("public_pages.title")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-content-secondary md:text-base">
              {t("public_pages.description")}
            </p>
          </div>

          <Suspense fallback={<CardGridSkeleton count={6} />}>
            <Await
              resolve={data.publicPages}
              errorElement={
                <p className="rounded-lg border border-dashed border-border-strong px-5 py-8 text-sm text-feedback-danger-foreground">
                  Failed to load pages.
                </p>
              }
            >
              {(publicPages) =>
                publicPages.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border-strong px-5 py-8 text-sm text-content-tertiary">
                    {t("public_pages.empty")}
                  </p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {publicPages.map((page) => {
                      const title = isJa
                        ? page.titleJa || page.titleEn
                        : page.titleEn || page.titleJa;
                      const summary = isJa
                        ? page.summaryJa || page.summaryEn
                        : page.summaryEn || page.summaryJa;
                      return (
                        <li key={page.id}>
                          <Link
                            to={page.wikiPath}
                            className="group flex h-full flex-col rounded-xl border border-border-default bg-surface-raised p-5 transition-colors hover:border-border-focus hover:bg-surface-selected/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                          >
                            <h2 className="line-clamp-2 font-semibold text-content-primary group-hover:text-action-primary-hover">
                              {title}
                            </h2>
                            {summary && (
                              <p className="mt-2 line-clamp-3 text-sm leading-6 text-content-secondary">
                                {summary}
                              </p>
                            )}
                            {page.updatedAt && (
                              <time className="mt-4 text-xs text-content-disabled">
                                {timeAgo(new Date(page.updatedAt), t)}
                              </time>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )
              }
            </Await>
          </Suspense>
        </section>
      </div>
    );
  }

  // Home page for authenticated users
  const isJa = i18n.language !== "en";

  return (
    <div className="max-w-5xl px-4 py-6 md:px-8 md:py-8">
      {/* Section 1: Create with AI CTA */}
      <HomeCta />

      <Suspense fallback={<CardGridSkeleton count={4} />}>
        <Await
          resolve={data.homeData}
          errorElement={
            <p className="text-sm text-feedback-danger-foreground">Failed to load content.</p>
          }
        >
          {({ recentPages, allTags, recentComments }) => (
            <>
              {/* Section 2: Browse by Tag */}
              <section className="mb-10">
                <h2 className="mb-4 text-lg font-semibold text-content-primary">
                  {t("home.browse_by_tag")}
                </h2>

                {allTags.length === 0 ? (
                  <p className="text-sm text-content-disabled">{t("home.no_tags_yet")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allTags.map((tag) => (
                      <TagChip
                        key={tag.slug}
                        tagSlug={tag.slug}
                        labelJa={tag.labelJa}
                        labelEn={tag.labelEn}
                        color={tag.color}
                        size="md"
                        pageCount={tag.pageCount}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Section 3: Discover what's happening */}
              <section>
                <h2 className="mb-4 text-lg font-semibold text-content-primary">
                  {t("home.activity_heading")}
                </h2>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {/* Recent pages column */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-content-disabled">
                      {t("home.activity_pages_heading")}
                    </h3>
                    {recentPages.length === 0 ? (
                      <p className="text-sm text-content-disabled">{t("home.no_activity_pages")}</p>
                    ) : (
                      <ul className="flex flex-col divide-y divide-border-subtle">
                        {recentPages.map((page) => (
                          <li key={page.id}>
                            <Link
                              to={page.wikiPath}
                              className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-action-primary"
                            >
                              <span className="line-clamp-1 font-medium text-content-primary">
                                {isJa ? page.titleJa || page.titleEn : page.titleEn || page.titleJa}
                              </span>
                              {page.updatedAt && (
                                <time className="shrink-0 text-xs text-content-disabled">
                                  {timeAgo(new Date(page.updatedAt), t)}
                                </time>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Recent comments column */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-content-disabled">
                      {t("home.activity_comments_heading")}
                    </h3>
                    {recentComments.length === 0 ? (
                      <p className="text-sm text-content-disabled">
                        {t("home.no_activity_comments")}
                      </p>
                    ) : (
                      <ul className="flex flex-col divide-y divide-border-subtle">
                        {recentComments.map((c) => (
                          <li key={c.commentId}>
                            <Link
                              to={c.wikiPath}
                              className="flex items-start gap-2.5 py-2.5 transition-colors hover:text-action-primary"
                            >
                              {c.authorImage ? (
                                <img
                                  src={c.authorImage}
                                  alt={c.authorName}
                                  className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-feedback-info-surface text-[10px] font-semibold text-action-primary-hover">
                                  {c.authorName.slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm text-content-secondary">
                                  <span className="font-medium text-content-primary">
                                    {c.authorName}
                                  </span>{" "}
                                  {t("home.activity_commented_on")}{" "}
                                  <span className="font-medium text-content-primary">
                                    {isJa
                                      ? c.pageTitleJa || c.pageTitleEn
                                      : c.pageTitleEn || c.pageTitleJa}
                                  </span>
                                </span>
                                {c.commentedAt && (
                                  <time className="text-xs text-content-disabled">
                                    {timeAgo(new Date(c.commentedAt), t)}
                                  </time>
                                )}
                              </div>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}
        </Await>
      </Suspense>
    </div>
  );
}
