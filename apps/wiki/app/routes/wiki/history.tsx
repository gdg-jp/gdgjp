import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { loadPageHistory, revertPageVersion } from "~/features/pages/history.server";
import { HistoryView } from "./_components/HistoryView";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data
      ? `History: ${data.page.titleEn || data.page.titleJa} — GDG Japan Wiki`
      : "Page history",
  },
];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  return loadPageHistory(request, context.cloudflare.env, params.slug);
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  return revertPageVersion(request, context.cloudflare.env, params.slug);
}

export default function WikiHistory() {
  return <HistoryView {...useLoaderData<typeof loader>()} />;
}
