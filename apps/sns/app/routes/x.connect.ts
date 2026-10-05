import { redirect } from "react-router";
import { requireSnsAccess } from "~/features/auth/access.server";
import { safeReturnTo } from "~/features/auth/return-to";
import { xOAuthDepsFromEnv } from "~/features/x-accounts/x-account.deps.server";
import { beginXConnect } from "~/features/x-accounts/x-oauth.service.server";
import type { Route } from "./+types/x.connect";
export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const url = new URL(request.url);
  const { authorizationUrl } = await beginXConnect(xOAuthDepsFromEnv(context.cloudflare.env), {
    userId: access.user.id,
    chapterId: access.chapter.chapterId,
    returnTo: safeReturnTo(url.searchParams.get("return_to") ?? "/settings"),
  });
  throw redirect(authorizationUrl);
}
