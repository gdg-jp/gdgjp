import { redirect } from "react-router";
import { requireMember } from "~/lib/auth-redirect.server";
import { encryptSecret } from "~/lib/crypto.server";
import {
  consumeOAuthTransaction,
  setEventGoogleAdmin,
  upsertGoogleOAuthToken,
} from "~/lib/db.server";
import { exchangeGoogleCode } from "~/lib/google-oauth.server";
import type { Route } from "./+types/google.callback";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user } = await requireMember(env, request);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) throw new Response("Missing Google OAuth response", { status: 400 });

  const transaction = await consumeOAuthTransaction(env.DB, state);
  if (!transaction || transaction.userId !== user.id) {
    throw new Response("Invalid or expired Google OAuth transaction", { status: 400 });
  }

  const { accessToken, refreshToken, expiresIn, email } = await exchangeGoogleCode(
    env,
    code,
    transaction.codeVerifier,
  );
  await upsertGoogleOAuthToken(env.DB, {
    userId: user.id,
    googleEmail: email,
    accessTokenEnc: await encryptSecret(env.TOKEN_ENCRYPTION_KEY, accessToken),
    refreshTokenEnc: await encryptSecret(env.TOKEN_ENCRYPTION_KEY, refreshToken),
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + expiresIn,
  });
  await setEventGoogleAdmin(env.DB, transaction.eventId, user.id);
  throw redirect(transaction.returnTo);
}
