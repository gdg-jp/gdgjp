import { and, desc, eq, isNull } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import TagChip from "~/components/TagChip";
import * as schema from "~/db/schema";
import { getAccessIdentity } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { buildVisibilityFilter } from "~/lib/page-visibility.server";
import { timeAgo } from "~/lib/time";

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
  const visFilter = buildVisibilityFilter(user, identity.chapterIds);

  if (!user) {
    const publicPages = await db
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
      .all();

    return { mode: "public" as const, publicPages };
  }

  const [recentPages, allTags, recentComments] = await Promise.all([
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
  ]);

  return {
    mode: "home" as const,
    recentPages,
    allTags,
    recentComments,
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
              className="text-2xl font-bold tracking-tight text-gray-900 md:text-3xl"
            >
              {t("public_pages.title")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-gray-600 md:text-base">
              {t("public_pages.description")}
            </p>
          </div>

          {data.publicPages.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-5 py-8 text-sm text-gray-500">
              {t("public_pages.empty")}
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.publicPages.map((page) => {
                const title = isJa ? page.titleJa || page.titleEn : page.titleEn || page.titleJa;
                const summary = isJa
                  ? page.summaryJa || page.summaryEn
                  : page.summaryEn || page.summaryJa;
                return (
                  <li key={page.id}>
                    <Link
                      to={`/wiki/${page.slug}`}
                      className="group flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <h2 className="line-clamp-2 font-semibold text-gray-900 group-hover:text-blue-700">
                        {title}
                      </h2>
                      {summary && (
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-600">
                          {summary}
                        </p>
                      )}
                      {page.updatedAt && (
                        <time className="mt-4 text-xs text-gray-400">
                          {timeAgo(new Date(page.updatedAt), t)}
                        </time>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // Home page for authenticated users
  const { recentPages, allTags, recentComments } = data;
  const isJa = i18n.language !== "en";

  return (
    <div className="max-w-5xl px-4 py-6 md:px-8 md:py-8">
      {/* Section 1: Create with AI CTA */}
      <section className="mb-10">
        <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100 px-6 py-8 md:px-10 md:py-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-blue-200/40 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-8 left-1/3 h-32 w-32 rounded-full bg-blue-200/40 blur-2xl"
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-6 w-6 text-blue-500"
                >
                  <path
                    fillRule="evenodd"
                    d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5ZM16.5 15a.75.75 0 0 1 .712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 0 1 0 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 0 1-1.422 0l-.395-1.183a1.5 1.5 0 0 0-.948-.948l-1.183-.395a.75.75 0 0 1 0-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0 1 16.5 15Z"
                    clipRule="evenodd"
                  />
                </svg>
                <h2 className="text-xl font-bold text-gray-900 md:text-2xl">
                  {t("home.cta_heading")}
                </h2>
              </div>
              <p className="max-w-lg text-sm leading-relaxed text-gray-600 md:text-base">
                {t("home.cta_subheading")}
              </p>
            </div>
            <Link
              to="/ingest"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border-2 border-black bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[3px_3px_0px_0px_#000] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_#000]"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path
                  fillRule="evenodd"
                  d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5Z"
                  clipRule="evenodd"
                />
              </svg>
              {t("home.cta_button")}
            </Link>
          </div>
        </div>
      </section>

      {/* Section 2: Browse by Tag */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("home.browse_by_tag")}</h2>

        {allTags.length === 0 ? (
          <p className="text-sm text-gray-400">{t("home.no_tags_yet")}</p>
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
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("home.activity_heading")}</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Recent pages column */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
              {t("home.activity_pages_heading")}
            </h3>
            {recentPages.length === 0 ? (
              <p className="text-sm text-gray-400">{t("home.no_activity_pages")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-gray-100">
                {recentPages.map((page) => (
                  <li key={page.id}>
                    <Link
                      to={`/wiki/${page.slug}`}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-blue-600"
                    >
                      <span className="line-clamp-1 font-medium text-gray-800">
                        {isJa ? page.titleJa || page.titleEn : page.titleEn || page.titleJa}
                      </span>
                      {page.updatedAt && (
                        <time className="shrink-0 text-xs text-gray-400">
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
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
              {t("home.activity_comments_heading")}
            </h3>
            {recentComments.length === 0 ? (
              <p className="text-sm text-gray-400">{t("home.no_activity_comments")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-gray-100">
                {recentComments.map((c) => (
                  <li key={c.commentId}>
                    <Link
                      to={`/wiki/${c.pageSlug}`}
                      className="flex items-start gap-2.5 py-2.5 transition-colors hover:text-blue-600"
                    >
                      {c.authorImage ? (
                        <img
                          src={c.authorImage}
                          alt={c.authorName}
                          className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-semibold text-blue-700">
                          {c.authorName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm text-gray-700">
                          <span className="font-medium text-gray-900">{c.authorName}</span>{" "}
                          {t("home.activity_commented_on")}{" "}
                          <span className="font-medium text-gray-900">
                            {isJa ? c.pageTitleJa || c.pageTitleEn : c.pageTitleEn || c.pageTitleJa}
                          </span>
                        </span>
                        {c.commentedAt && (
                          <time className="text-xs text-gray-400">
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
    </div>
  );
}
