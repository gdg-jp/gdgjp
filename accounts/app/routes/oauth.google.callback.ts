// Google upstream callback: exchange code → userinfo → upsert local user → set IdP session → redirect.
//
// Looks up the local user by email (so existing accounts keep their UUID) and
// mints a fresh UUID for first-time sign-ins. user.id is intentionally NOT the
// Google sub — we keep our own opaque identifier and reuse the IdP's sub only
// to look users up via email.

import { redirect } from "react-router";
import { handleGoogleCallback } from "~/lib/google.server";
import { buildIdpSessionCookie } from "~/lib/idp-session.server";
import type { Route } from "./+types/oauth.google.callback";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const result = await handleGoogleCallback({
    request,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    secret: env.IDP_SESSION_SECRET,
  });

  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(`SELECT id, is_admin FROM "user" WHERE email = ? LIMIT 1`)
    .bind(result.user.email)
    .first<{ id: string; is_admin: number }>();

  let userId: string;
  let isAdmin: boolean;
  if (existing) {
    userId = existing.id;
    isAdmin = existing.is_admin === 1;
    await env.DB.prepare(`UPDATE "user" SET name = ?, image = ?, updated_at = ? WHERE id = ?`)
      .bind(result.user.name, result.user.picture, now, userId)
      .run();
  } else {
    userId = crypto.randomUUID();
    isAdmin = false;
    await env.DB.prepare(
      `INSERT INTO "user" (id, email, name, image, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
      .bind(userId, result.user.email, result.user.name, result.user.picture, now, now)
      .run();
  }

  const sessionCookie = await buildIdpSessionCookie(
    { userId, email: result.user.email, isAdmin },
    env.IDP_SESSION_SECRET,
    env.APP_URL,
  );

  const headers = new Headers({ Location: result.returnTo });
  headers.append("Set-Cookie", sessionCookie);
  headers.append("Set-Cookie", result.clearTxCookie);
  return new Response(null, { status: 302, headers });
}
