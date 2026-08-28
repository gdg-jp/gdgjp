import { serializeCookie, signPayload } from "@gdgjp/gdg-lib";
import { safeReturnTo } from "~/lib/return-to";
import type { Route } from "./+types/dev.login";

/**
 * Local-dev / e2e sign-in shortcut. Mints a valid `gdgjp-ost-session` cookie and
 * an `ost-dev-chapters` override (read by `chapter.server.ts`) without a real
 * Google round-trip. Hard 404 in production.
 *
 *   /dev/login?as=owner&chapter=1:dev-chapter&return_to=/demo/edit
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (env.ENVIRONMENT === "production") {
    throw new Response(null, { status: 404 });
  }

  const url = new URL(request.url);
  const as =
    (url.searchParams.get("as") ?? "dev").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "dev";
  const [chapterIdRaw, chapterSlugRaw] = (url.searchParams.get("chapter") ?? "1:dev-chapter").split(
    ":",
  );
  const chapterId = Number.parseInt(chapterIdRaw ?? "1", 10) || 1;
  const chapterSlug = chapterSlugRaw || "dev-chapter";

  const issuer = env.IDP_URL.replace(/\/+$/, "");
  const subject = `dev-${as}`;
  const userId = `dev-user-${as}`;
  const email = `${as}@dev.local`;
  const name = `${as} (dev)`;
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO "user" (id, email, name, image, is_admin, oidc_issuer, oidc_subject, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
  )
    .bind(userId, email, name, issuer, subject, now, now)
    .run();

  const session = {
    version: 3 as const,
    sessionId: crypto.randomUUID(),
    userId,
    issuer,
    subject,
    email,
    name,
    picture: null,
    isAdmin: false,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  const signed = await signPayload(session, env.RP_SESSION_SECRET);
  const secure = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.APP_URL);

  const chapters = [{ chapterId, chapterSlug, role: "organizer" as const }];
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    serializeCookie({
      name: "gdgjp-ost-session",
      value: signed,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      sameSite: "Lax",
      secure,
    }),
  );
  headers.append(
    "Set-Cookie",
    serializeCookie({
      name: "ost-dev-chapters",
      value: encodeURIComponent(JSON.stringify(chapters)),
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: false,
      sameSite: "Lax",
      secure,
    }),
  );

  const to = safeReturnTo(url.searchParams.get("return_to")) ?? "/";
  headers.set("Location", to);
  return new Response(null, { status: 302, headers });
}

export default function DevLogin() {
  return null;
}
