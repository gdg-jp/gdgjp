import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { buildPageMeta } from "~/features/pages/meta";
import { handleWikiPageAction, loadWikiPage } from "~/features/pages/wiki-page.server";
import { WikiPageView } from "./_components/WikiPageView";

export const meta: MetaFunction<typeof loader> = ({ data, location, matches }) => {
  if (!data) return [{ title: "Page not found" }];

  const origin = (matches.find((match) => match.id === "root")?.data as { origin?: string })
    ?.origin;
  const isEnglish = data.lang === "en";
  const title =
    (isEnglish ? data.page.titleEn : data.page.titleJa) || data.page.titleJa || data.page.titleEn;
  const description =
    (isEnglish ? data.page.summaryEn : data.page.summaryJa) ||
    data.page.summaryJa ||
    data.page.summaryEn;

  return buildPageMeta({
    title,
    description,
    imagePath: `/og/wiki/${encodeURIComponent(data.page.slug)}?lang=${isEnglish ? "en" : "ja"}&v=${new Date(data.page.updatedAt).getTime()}`,
    visibility: data.page.visibility,
    origin: origin ?? "",
    pathname: isEnglish ? `${location.pathname}?lang=en` : location.pathname,
  });
};

export async function loader(args: LoaderFunctionArgs) {
  return loadWikiPage(args);
}

export const action = handleWikiPageAction;

export default function WikiPage() {
  return <WikiPageView />;
}
