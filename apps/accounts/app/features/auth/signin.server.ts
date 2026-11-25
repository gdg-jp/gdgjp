import { safeReturnTo } from "@gdgjp/gdg-lib/auth/return-to";
import { redirect } from "react-router";
import { signedInDestination } from "~/features/auth/auth-redirect";
import { getSessionUser } from "~/features/auth/auth.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadSignin({ request, context }: RouteRequestArgs) {
  const env = context.cloudflare.env;
  const t = await i18n.getFixedT(request);
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to"), url.origin) ?? "/dashboard";
  const session = await getSessionUser(env, request);
  if (session) throw redirect(signedInDestination(url));
  return { title: t("meta.signin"), returnTo };
}
