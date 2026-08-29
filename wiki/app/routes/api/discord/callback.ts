import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { exchangeDiscordCodeForToken, fetchDiscordCurrentUser } from "~/lib/discord-oauth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) throw redirect("/sources?error=discord_auth_denied");
  if (!code || !state) throw redirect("/sources?error=discord_auth_invalid");

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const stateCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("discord_oauth_state="))
    ?.replace(/^discord_oauth_state=/, "");

  if (!stateCookie || stateCookie !== state) {
    throw redirect("/sources?error=discord_auth_state_mismatch");
  }

  const colonIdx = state.indexOf(":");
  const returnTo = colonIdx >= 0 ? state.slice(colonIdx + 1) : "/sources";
  const safePath = returnTo.startsWith("/") ? returnTo : "/sources";
  const withError = (key: string) => `${safePath}${safePath.includes("?") ? "&" : "?"}error=${key}`;

  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    throw redirect(withError("discord_not_configured"));
  }

  const redirectUri = `${url.origin}/api/discord/callback`;

  try {
    const token = await exchangeDiscordCodeForToken(
      code,
      env.DISCORD_CLIENT_ID,
      env.DISCORD_CLIENT_SECRET,
      redirectUri,
    );
    const discordUser = await fetchDiscordCurrentUser(token.accessToken);
    const db = getDb(env);
    const now = new Date();

    await db
      .insert(schema.discordOauthTokens)
      .values({
        userId: user.id,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        grantedScopes: token.grantedScopes,
        discordUserId: discordUser.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.discordOauthTokens.userId,
        set: {
          accessToken: token.accessToken,
          ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
          expiresAt: token.expiresAt,
          grantedScopes: token.grantedScopes,
          discordUserId: discordUser.id,
          updatedAt: now,
        },
      });

    const prefs = await db
      .select({ discordId: schema.userPreferences.discordId })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, user.id))
      .get();
    if (prefs && !prefs.discordId) {
      await db
        .update(schema.userPreferences)
        .set({ discordId: discordUser.id })
        .where(eq(schema.userPreferences.userId, user.id));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Discord OAuth callback error:", msg);
    throw redirect(withError("discord_auth_failed"));
  }

  throw redirect(safePath, {
    headers: {
      "Set-Cookie": "discord_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    },
  });
}
