import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { refreshAccessToken } from "~/features/google/drive.server";

type Db = ReturnType<typeof drizzle>;

export interface GoogleDriveTokenRow {
  accessToken: string;
  grantedScopes: string | null;
}

/** Returns a usable Drive token and persists a refresh when the stored one expired. */
export async function getGoogleDriveAccessToken(env: Env, db: Db, userId: string): Promise<string> {
  const row = await getGoogleDriveTokenRow(env, db, userId);
  return row.accessToken;
}

/** Same as getGoogleDriveAccessToken, but also returns the scopes recorded at consent. */
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

  if (token.expiresAt >= new Date() || !token.refreshToken) {
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
