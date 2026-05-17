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

// The OAuthProvider routes GET/POST /userinfo here after validating the bearer token.
// ctx.props is the GrantProps we set in completeAuthorization, with live chapter
// claims appended on every request.
const userinfoHandler: HandlerWithFetch = {
  async fetch(_request, env, ctx) {
    const props = (ctx as ExecutionContext & { props?: GrantProps }).props;
    if (!props) {
      return json({ error: "no_props" }, 500);
    }
    const chapters = await listActiveChaptersForUser(env.DB, props.sub);
    const primary = chapters[0] ?? null;
    return json({
      sub: props.sub,
      email: props.email,
      name: props.name,
      picture: props.picture,
      email_verified: true,
      isAdmin: props.isAdmin,
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
