import { redirect } from "react-router";
import { requireSnsAccess } from "~/lib/access.server";
import { encryptSecret } from "~/lib/crypto.server";
import { nowIso } from "~/lib/utils";
import { exchangeXCode } from "~/lib/x.server";
import type { Route } from "./+types/x.callback";
type Transaction = {
  user_id: string;
  chapter_id: number;
  code_verifier: string;
  return_to: string;
  expires_at: string;
};
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) throw new Response("Missing X OAuth response", { status: 400 });
  const transaction = await env.DB.prepare(
    "SELECT user_id, chapter_id, code_verifier, return_to, expires_at FROM oauth_transactions WHERE state = ? AND provider = 'x'",
  )
    .bind(state)
    .first<Transaction>();
  await env.DB.prepare("DELETE FROM oauth_transactions WHERE state = ?").bind(state).run();
  if (
    !transaction ||
    transaction.user_id !== access.user.id ||
    transaction.chapter_id !== access.chapter.chapterId ||
    new Date(transaction.expires_at) < new Date()
  )
    throw new Response("Invalid or expired X OAuth transaction", { status: 400 });
  const { token, user } = await exchangeXCode(env, code, transaction.code_verifier);
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO x_accounts (id, chapter_id, x_user_id, username, display_name, profile_image_url, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, authorized_by_user_id, created_at, updated_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(chapter_id, x_user_id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, profile_image_url = excluded.profile_image_url, access_token_ciphertext = excluded.access_token_ciphertext, refresh_token_ciphertext = excluded.refresh_token_ciphertext, access_token_expires_at = excluded.access_token_expires_at, authorized_by_user_id = excluded.authorized_by_user_id, updated_at = excluded.updated_at, revoked_at = NULL",
  )
    .bind(
      crypto.randomUUID(),
      transaction.chapter_id,
      user.id,
      user.username,
      user.name,
      user.profile_image_url ?? null,
      await encryptSecret(env.TOKEN_ENCRYPTION_KEY, token.access_token),
      token.refresh_token
        ? await encryptSecret(env.TOKEN_ENCRYPTION_KEY, token.refresh_token)
        : null,
      token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      access.user.id,
      now,
      now,
    )
    .run();
  throw redirect(transaction.return_to);
}
