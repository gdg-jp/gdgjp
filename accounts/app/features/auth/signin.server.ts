import { redirect } from "react-router";
import { safeReturnTo, signedInDestination } from "~/features/auth/auth-redirect";
import { getSessionUser } from "~/features/auth/auth.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadSignin({ request, context }: RouteRequestArgs) {
  const env = context.cloudflare.env;
  const t = await i18n.getFixedT(request);
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/dashboard";
  // Resume an OAuth authorization request when the provider sent the user here.
  // A normal, first-party sign-in still jumps straight to return_to.
  const session = await getSessionUser(env, request);
  if (session) throw redirect(signedInDestination(url.searchParams));
  return { title: t("meta.signin"), returnTo };
}
