// Centralized OAuthProvider configuration + cached helper accessor.
// The provider is instantiated once in workers/app.ts; routes call
// `getOAuthHelpers(env)` to get a fresh helpers instance bound to env.

import {
  type OAuthHelpers,
  type OAuthProviderOptions,
  getOAuthApi,
} from "@cloudflare/workers-oauth-provider";
import { listActiveChaptersForUser } from "./db";

// Library wants `fetch` required on every handler; widen our local type.
type HandlerWithFetch = ExportedHandler<Env> & {
  fetch: NonNullable<ExportedHandler<Env>["fetch"]>;
};

// Props attached to every grant. Used by:
//   - completeAuthorization() at /authorize
//   - the userinfo apiHandler (via ctx.props)
export interface GrantProps {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  isAdmin: boolean;
}

export const AUTHORIZE_PATH = "/authorize";
export const TOKEN_PATH = "/oauth/token";
export const USERINFO_PATH = "/userinfo";

export function buildOAuthOptions(args: {
  appUrl: string;
  defaultHandler: HandlerWithFetch;
}): OAuthProviderOptions<Env> {
  const base = trimTrailing(args.appUrl);
  return {
    authorizeEndpoint: `${base}${AUTHORIZE_PATH}`,
    tokenEndpoint: `${base}${TOKEN_PATH}`,
    apiRoute: [`${base}${USERINFO_PATH}`],
    apiHandler: userinfoHandler,
    defaultHandler: args.defaultHandler,
    scopesSupported: ["openid", "email", "profile", "offline_access"],
    accessTokenTTL: 60 * 60,
    refreshTokenTTL: 60 * 60 * 24 * 30,
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    // We pre-register OAuth clients via the seed:clients script.
    // Dynamic client registration is disabled by omitting clientRegistrationEndpoint.
  };
}

export function getOAuthHelpers(env: Env): OAuthHelpers {
  // getOAuthApi is cheap; no caching needed.
  return getOAuthApi(
    buildOAuthOptions({ appUrl: env.APP_URL, defaultHandler: { fetch: passthrough } }),
    env,
  );
}

// The OAuthProvider routes GET/POST /userinfo here after validating the bearer
// token. ctx.props identifies the user (via props.sub set in
// completeAuthorization); the email/name/picture/isAdmin in props are a
// snapshot from sign-in time and can be up to refreshTokenTTL (30 days)
// stale, so we re-read the user row from D1 on every call. Chapter memberships
// are already loaded fresh below.
const userinfoHandler: HandlerWithFetch = {
  async fetch(_request, env, ctx) {
    const props = (ctx as ExecutionContext & { props?: GrantProps }).props;
    if (!props) {
      return json({ error: "no_props" }, 500);
    }
    const row = await env.DB.prepare(
      `SELECT email, name, image, is_admin FROM "user" WHERE id = ? LIMIT 1`,
    )
      .bind(props.sub)
      .first<{ email: string; name: string; image: string | null; is_admin: number }>();
    if (!row) {
      // User was deleted between grant and this call — token effectively revoked.
      return json({ error: "user_not_found" }, 401);
    }
    const chapters = await listActiveChaptersForUser(env.DB, props.sub);
    const primary = chapters[0] ?? null;
    return json({
      sub: props.sub,
      email: row.email,
      name: row.name,
      picture: row.image,
      email_verified: true,
      isAdmin: row.is_admin === 1,
      chapterId: primary?.chapterId ?? null,
      chapterSlug: primary?.chapterSlug ?? null,
      chapterRole: primary?.role ?? null,
      chapters: chapters.map((c) => ({
        chapterId: c.chapterId,
        chapterSlug: c.chapterSlug,
        role: c.role,
      })),
    });
  },
};

// Stub used only for the helpers-accessor; never invoked because we only call
// readonly helpers (parseAuthRequest, completeAuthorization, createClient, etc.).
function passthrough(): Response {
  return new Response("not implemented", { status: 500 });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function trimTrailing(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
