import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { refreshAccessToken } from "~/features/google/drive-oauth.server";

type Db = ReturnType<typeof drizzle>;

export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

export interface GoogleDriveTokenRow {
  accessToken: string;
  grantedScopes: string | null;
}

export async function getGoogleDriveAccessToken(env: Env, db: Db, userId: string): Promise<string> {
  const row = await getGoogleDriveTokenRow(env, db, userId);
  return row.accessToken;
}

export async function getGoogleDriveTokenRow(
  env: Env,
  db: Db,
  userId: string,
): Promise<GoogleDriveTokenRow> {
  const token = await db
    .select()
    .from(schema.googleDriveTokens)
    .where(eq(schema.googleDriveTokens.userId, userId))
    .get();
  if (!token) throw new Error("Google Drive is not connected");

  if (token.expiresAt.getTime() - TOKEN_REFRESH_MARGIN_MS > Date.now() || !token.refreshToken) {
    return { accessToken: token.accessToken, grantedScopes: token.grantedScopes ?? null };
  }

  const refreshed = await refreshAccessToken(
    token.refreshToken,
    env.GOOGLE_DOCS_CLIENT_ID,
    env.GOOGLE_DOCS_CLIENT_SECRET,
  );
  const grantedScopes = refreshed.grantedScopes ?? token.grantedScopes ?? null;
  await db
    .update(schema.googleDriveTokens)
    .set({
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      ...(refreshed.grantedScopes ? { grantedScopes: refreshed.grantedScopes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.googleDriveTokens.userId, userId));
  return { accessToken: refreshed.accessToken, grantedScopes };
}
