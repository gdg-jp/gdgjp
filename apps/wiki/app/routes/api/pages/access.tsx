import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { handlePageAccessAction, loadPageAccess } from "~/features/pages/page-access-api.server";

// GET — explicit shares, owner and the caller's evaluated permissions.
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  return loadPageAccess(context.cloudflare.env, request, params.pageId);
}

// POST — batch grant, one-grant update/remove, and general-access changes.
export async function action({ request, context, params }: ActionFunctionArgs) {
  return handlePageAccessAction(context.cloudflare.env, request, params.pageId);
}
