import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import {
  hasRequiredDiscordOauthScopes,
  refreshDiscordAccessToken,
} from "~/features/discord/oauth.server";

type Db = ReturnType<typeof drizzle>;

export interface DiscordOauthTokenRow {
  accessToken: string;
  grantedScopes: string | null;
  discordUserId: string | null;
}

/** Returns a usable Discord user OAuth token, refreshing when expired. */
export async function getDiscordOauthTokenRow(
  env: Env,
  db: Db,
  userId: string,
): Promise<DiscordOauthTokenRow> {
  const token = await db
    .select()
    .from(schema.discordOauthTokens)
    .where(eq(schema.discordOauthTokens.userId, userId))
    .get();
  if (!token) throw new Error("Discord is not connected");

  if (token.expiresAt >= new Date() || !token.refreshToken) {
    return {
      accessToken: token.accessToken,
      grantedScopes: token.grantedScopes ?? null,
      discordUserId: token.discordUserId ?? null,
    };
  }

  const refreshed = await refreshDiscordAccessToken(
    token.refreshToken,
    env.DISCORD_CLIENT_ID,
    env.DISCORD_CLIENT_SECRET,
  );
  const grantedScopes = refreshed.grantedScopes ?? token.grantedScopes ?? null;
  await db
    .update(schema.discordOauthTokens)
    .set({
      accessToken: refreshed.accessToken,
      ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
      expiresAt: refreshed.expiresAt,
      ...(refreshed.grantedScopes ? { grantedScopes: refreshed.grantedScopes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.discordOauthTokens.userId, userId));

  return {
    accessToken: refreshed.accessToken,
    grantedScopes,
    discordUserId: token.discordUserId ?? null,
  };
}

export function assertDiscordOauthScopes(grantedScopes: string | null | undefined): void {
  if (!hasRequiredDiscordOauthScopes(grantedScopes)) {
    throw new Error("Discord OAuth scopes are missing");
  }
}
