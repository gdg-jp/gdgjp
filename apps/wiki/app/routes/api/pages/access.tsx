import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { handlePageAccessAction, loadPageAccess } from "~/features/pages/page-access-api.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  return loadPageAccess(context.cloudflare.env, request, params.pageId);
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  return handlePageAccessAction(context.cloudflare.env, request, params.pageId);
}
