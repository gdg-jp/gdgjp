import { drizzle } from "drizzle-orm/d1";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { exchangeCodeForToken } from "~/lib/google-drive.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "member");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw redirect("/ingest?error=drive_auth_denied");
  }

  if (!code || !state) {
    throw redirect("/ingest?error=drive_auth_invalid");
  }

  // Verify state from cookie
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const stateCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("gdrive_oauth_state="))
    ?.replace(/^gdrive_oauth_state=/, "");

  if (!stateCookie || stateCookie !== state) {
    throw redirect("/ingest?error=drive_auth_state_mismatch");
  }

  // Extract returnTo path from state (format: "nonce:/path")
  const colonIdx = state.indexOf(":");
  const returnTo = colonIdx >= 0 ? state.slice(colonIdx + 1) : "/ingest";
  // Ensure returnTo is a relative path to prevent open redirect
  const safePath = returnTo.startsWith("/") ? returnTo : "/ingest";

  const redirectUri = `${url.origin}/api/google-drive/callback`;

  try {
    const token = await exchangeCodeForToken(
      code,
      env.GOOGLE_DOCS_CLIENT_ID,
      env.GOOGLE_DOCS_CLIENT_SECRET,
      redirectUri,
    );

    const db = drizzle(env.DB, { schema });
    const now = new Date();

    // Upsert token
    await db
      .insert(schema.googleDriveTokens)
      .values({
        userId: user.id,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.googleDriveTokens.userId,
        set: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          updatedAt: now,
        },
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Google Drive OAuth callback error:", msg);
    throw redirect(`${safePath}?error=drive_auth_failed`);
  }

  // Clear state cookie and redirect back
  throw redirect(safePath, {
    headers: {
      "Set-Cookie": "gdrive_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    },
  });
}
