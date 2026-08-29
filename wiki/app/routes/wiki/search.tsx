import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { loadWikiSearch } from "~/features/ai-search/wiki-search.server";
import { SearchView } from "./_components/SearchView";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.q ? `"${data.q}" — Search — GDG Japan Wiki` : "Search — GDG Japan Wiki" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  return loadWikiSearch(request, context.cloudflare.env);
}

export default function SearchPage() {
  return <SearchView />;
}
