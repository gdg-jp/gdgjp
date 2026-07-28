import { redirect } from "react-router";
import { requireSnsAccess, safeReturnTo } from "~/lib/access.server";
import { nowIso } from "~/lib/utils";
import { randomVerifier, xAuthorizationUrl } from "~/lib/x.server";
import type { Route } from "./+types/x.connect";
export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const verifier = randomVerifier();
  await context.cloudflare.env.DB.prepare(
    "INSERT INTO oauth_transactions (state, provider, user_id, chapter_id, code_verifier, return_to, expires_at, created_at) VALUES (?, 'x', ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      state,
      access.user.id,
      access.chapter.chapterId,
      verifier,
      safeReturnTo(url.searchParams.get("return_to") ?? "/settings"),
      new Date(Date.now() + 10 * 60_000).toISOString(),
      nowIso(),
    )
    .run();
  throw redirect(await xAuthorizationUrl(context.cloudflare.env, state, verifier));
}
