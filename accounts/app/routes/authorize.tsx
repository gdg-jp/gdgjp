// /authorize — the OAuth authorization endpoint.
// The OAuthProvider routes this URL to defaultHandler (us). We:
//   1) parse the OAuth request via helpers.parseAuthRequest
//   2) if no IdP session, bounce to /signin with return_to = original /authorize URL
//   3) if logged in, look up the user, then call helpers.completeAuthorization
//      with the GrantProps the userinfo endpoint will later return.
//
// The user-facing consent screen is intentionally skipped: all our trusted RPs
// have skipConsent semantics today (set when seeded).

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { redirect } from "react-router";
import { readIdpSession } from "~/lib/idp-session.server";
import { type GrantProps, getOAuthHelpers } from "~/lib/oauth-provider.server";
import { seedClients } from "~/lib/seed-clients.server";
import type { Route } from "./+types/authorize";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const helpers = getOAuthHelpers(env);

  let authReq: Awaited<ReturnType<OAuthHelpers["parseAuthRequest"]>>;
  try {
    authReq = await helpers.parseAuthRequest(request);
  } catch (err) {
    // First /authorize after a fresh OAUTH_KV (cold dev start, CI, or a new
    // environment) will see the client not registered. Also re-seed when the
    // stored redirect URI no longer matches env (i.e. an RP's callback path
    // changed). seedClients overwrites existing entries — idempotent and safe.
    if (isUnknownClientError(err) || isRedirectMismatchError(err)) {
      try {
        await seedClients(env);
        authReq = await helpers.parseAuthRequest(request);
      } catch (retryErr) {
        console.error("authorize: parseAuthRequest failed after seed retry", retryErr);
        return new Response("Invalid authorization request", { status: 400 });
      }
    } else {
      console.error("authorize: parseAuthRequest failed", err);
      return new Response("Invalid authorization request", { status: 400 });
    }
  }

  const session = await readIdpSession(request, env.IDP_SESSION_SECRET);
  if (!session) {
    const returnTo = new URL(request.url).pathname + new URL(request.url).search;
    throw redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
  }

  // Look up the user for current name/picture.
  const row = await env.DB.prepare(
    `SELECT id, email, name, image, is_admin FROM "user" WHERE id = ? LIMIT 1`,
  )
    .bind(session.userId)
    .first<{ id: string; email: string; name: string; image: string | null; is_admin: number }>();
  if (!row) {
    // The session referenced a user that no longer exists — force re-auth.
    const returnTo = new URL(request.url).pathname + new URL(request.url).search;
    throw redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
  }

  const props: GrantProps = {
    sub: row.id,
    email: row.email,
    name: row.name,
    picture: row.image,
    isAdmin: row.is_admin === 1,
  };

  const { redirectTo } = await helpers.completeAuthorization({
    request: authReq,
    userId: row.id,
    scope: authReq.scope,
    metadata: {},
    props,
  });
  throw redirect(redirectTo);
}

function isUnknownClientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /invalid client/i.test(err.message);
}

function isRedirectMismatchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /invalid redirect uri/i.test(err.message);
}

export default function AuthorizeRoute() {
  // Unreachable: loader always throws a Response (redirect or error).
  return null;
}
