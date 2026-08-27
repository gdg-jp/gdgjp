import { redirect } from "react-router";
import { xOAuthDepsFromEnv } from "~/features/x-accounts/x-account.deps.server";
import { XOAuthError, completeXConnect } from "~/features/x-accounts/x-oauth.service.server";
import { requireSnsAccess } from "~/lib/access.server";
import type { Route } from "./+types/x.callback";
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const url = new URL(request.url);
  let returnTo: string;
  try {
    ({ returnTo } = await completeXConnect(xOAuthDepsFromEnv(env), {
      state: url.searchParams.get("state"),
      code: url.searchParams.get("code"),
      userId: access.user.id,
      chapterId: access.chapter.chapterId,
    }));
  } catch (error) {
    if (error instanceof XOAuthError) throw new Response(error.message, { status: 400 });
    throw error;
  }
  throw redirect(returnTo);
}
