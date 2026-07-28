import { redirect } from "react-router";
import { requireSnsAccess } from "~/lib/access.server";
import { encryptSecret } from "~/lib/crypto.server";
import { nowIso } from "~/lib/utils";
import type { Route } from "./+types/google.photos.callback";
type Tx = { user_id: string; code_verifier: string; return_to: string; expires_at: string };
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) throw new Response("Missing Google OAuth response", { status: 400 });
  const tx = await env.DB.prepare(
    "SELECT user_id, code_verifier, return_to, expires_at FROM oauth_transactions WHERE state = ? AND provider = 'google_photos'",
  )
    .bind(state)
    .first<Tx>();
  await env.DB.prepare("DELETE FROM oauth_transactions WHERE state = ?").bind(state).run();
  if (!tx || tx.user_id !== access.user.id || new Date(tx.expires_at) < new Date())
    throw new Response("Invalid Google OAuth transaction", { status: 400 });
  const response = await fetch(env.GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_PHOTOS_CLIENT_ID,
      client_secret: env.GOOGLE_PHOTOS_CLIENT_SECRET,
      redirect_uri: `${env.APP_URL}/google/photos/callback`,
      grant_type: "authorization_code",
      code_verifier: tx.code_verifier,
    }),
  });
  const token = await response.json<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>();
  if (!response.ok || !token.access_token)
    throw new Response("Google Photos authorization failed", { status: 502 });
  await env.DB.prepare(
    "INSERT INTO google_photos_tokens (user_id, access_token_ciphertext, refresh_token_ciphertext, expires_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET access_token_ciphertext = excluded.access_token_ciphertext, refresh_token_ciphertext = COALESCE(excluded.refresh_token_ciphertext, google_photos_tokens.refresh_token_ciphertext), expires_at = excluded.expires_at, updated_at = excluded.updated_at",
  )
    .bind(
      access.user.id,
      await encryptSecret(env.TOKEN_ENCRYPTION_KEY, token.access_token),
      token.refresh_token
        ? await encryptSecret(env.TOKEN_ENCRYPTION_KEY, token.refresh_token)
        : null,
      token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      nowIso(),
    )
    .run();
  throw redirect(tx.return_to);
}
