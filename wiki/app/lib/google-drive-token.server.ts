import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { refreshAccessToken } from "~/lib/google-drive.server";

type Db = ReturnType<typeof drizzle>;

/** Returns a usable Drive token and persists a refresh when the stored one expired. */
export async function getGoogleDriveAccessToken(env: Env, db: Db, userId: string): Promise<string> {
  const token = await db
    .select()
    .from(schema.googleDriveTokens)
    .where(eq(schema.googleDriveTokens.userId, userId))
    .get();
  if (!token) throw new Error("Google Drive is not connected");

  if (token.expiresAt >= new Date() || !token.refreshToken) return token.accessToken;

  const refreshed = await refreshAccessToken(
    token.refreshToken,
    env.GOOGLE_DOCS_CLIENT_ID,
    env.GOOGLE_DOCS_CLIENT_SECRET,
  );
  await db
    .update(schema.googleDriveTokens)
    .set({
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.googleDriveTokens.userId, userId));
  return refreshed.accessToken;
}
