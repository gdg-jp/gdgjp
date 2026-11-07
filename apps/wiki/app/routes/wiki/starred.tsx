import { and, desc, eq } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { Link, type LoaderFunctionArgs, type MetaFunction, useLoaderData } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/features/auth/utils.server";
import { pagesInSpaces } from "~/features/pages/page-space.server";
import { getWikiAncestry, getWikiPageUrls } from "~/features/pages/wiki-page-path.server";
import { loadViewerContext } from "~/features/spaces/viewer.server";
import { getDb } from "~/lib/db.server";

export const meta: MetaFunction = () => [{ title: "Starred — GDG Japan Wiki" }];

/** `/starred`: the reader's favorites across every space they can reach, newest star first. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);
  const viewer = await loadViewerContext(request, env);
  const rows = await db
    .select({
      id: schema.pages.id,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      summaryJa: schema.pages.summaryJa,
      summaryEn: schema.pages.summaryEn,
      starredAt: schema.pageFavorites.createdAt,
    })
    .from(schema.pageFavorites)
    .innerJoin(schema.pages, eq(schema.pageFavorites.pageId, schema.pages.id))
    .where(
      and(
        eq(schema.pageFavorites.userId, user.id),
        eq(schema.pages.status, "published"),
        pagesInSpaces(viewer.visibleSpaceIds),
      ),
    )
    .orderBy(desc(schema.pageFavorites.createdAt))
    .all();
  const ids = rows.map((row) => row.id);
  const [urls, chains] = await Promise.all([getWikiPageUrls(env, ids), getWikiAncestry(env, ids)]);
  return {
    pages: rows.map((row) => ({
      ...row,
      wikiPath: urls.get(row.id) ?? "",
      ancestors: (chains.get(row.id) ?? []).slice(0, -1).map(({ titleJa, titleEn }) => ({
        titleJa,
        titleEn,
      })),
    })),
  };
}

export default function StarredPage() {
  const { pages } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const isJa = i18n.language !== "en";
  const pick = (ja: string, en: string) => (isJa ? ja || en : en || ja);
  return (
    <div className="max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-6 text-2xl font-bold text-foreground">{t("nav.starred")}</h1>
      {pages.length === 0 ? (
        <p className="text-sm text-muted/70">{t("starred.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pages.map((page) => (
            <li key={page.id}>
              <Link
                to={page.wikiPath}
                className="block rounded-lg border border-border bg-surface p-4 transition-[border-color,box-shadow] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] hover:border-border-ring/40 hover:shadow-sm"
              >
                <span className="font-medium text-foreground">
                  {pick(page.titleJa, page.titleEn)}
                </span>
                {page.ancestors.length > 0 && (
                  <p className="mt-0.5 truncate text-xs text-muted/70">
                    {page.ancestors.map((a) => pick(a.titleJa, a.titleEn)).join(" › ")}
                  </p>
                )}
                {pick(page.summaryJa, page.summaryEn) && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted">
                    {pick(page.summaryJa, page.summaryEn)}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
