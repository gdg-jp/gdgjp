import { serializeCookie, signPayload } from "@gdgjp/gdg-lib";
import { safeReturnTo } from "~/lib/return-to";
import type { Route } from "./+types/dev.login";

/**
 * Local-dev / e2e sign-in shortcut. Mints a valid `gdgjp-discord-relay-session` cookie and
 * a `discord-relay-dev-chapters` override without a real Google round-trip.
 * Hard 404 in production.
 *
 *   /dev/login?as=owner&chapter=1:dev-chapter&return_to=/
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
  const roleParam = url.searchParams.get("role");
  const role = roleParam === "member" ? "member" : "organizer";
  const isAdmin = url.searchParams.get("admin") === "1";

  const issuer = env.IDP_URL.replace(/\/+$/, "");
  const subject = `dev-${as}`;
  const userId = `dev-user-${as}`;
  const email = `${as}@dev.local`;
  const name = `${as} (dev)`;
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO "user" (id, email, name, image, is_admin, oidc_issuer, oidc_subject, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_admin = excluded.is_admin, updated_at = excluded.updated_at`,
  )
    .bind(userId, email, name, isAdmin ? 1 : 0, issuer, subject, now, now)
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
    isAdmin,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  const signed = await signPayload(session, env.RP_SESSION_SECRET);
  const secure = !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.APP_URL);

  const chapters = [{ chapterId, chapterSlug, role }];
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    serializeCookie({
      name: "gdgjp-discord-relay-session",
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
      name: "discord-relay-dev-chapters",
      value: encodeURIComponent(JSON.stringify({ chapters, isAdmin })),
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
