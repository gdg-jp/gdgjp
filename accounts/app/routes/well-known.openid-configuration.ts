// RFC 8414 / OIDC discovery document. We advertise as an OIDC-flavoured OAuth
// 2.1 server but DO NOT issue id_tokens — RPs must use openid-client with
// `idTokenExpected: false` and call /userinfo for user attributes.

import { AUTHORIZE_PATH, TOKEN_PATH, USERINFO_PATH } from "~/lib/oauth-provider.server";
import type { Route } from "./+types/well-known.openid-configuration";

export function loader({ context }: Route.LoaderArgs) {
  const issuer = trimTrailing(context.cloudflare.env.APP_URL);
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}${AUTHORIZE_PATH}`,
    token_endpoint: `${issuer}${TOKEN_PATH}`,
    userinfo_endpoint: `${issuer}${USERINFO_PATH}`,
    scopes_supported: ["openid", "email", "profile", "offline_access"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    subject_types_supported: ["public"],
    // No id_token issuance — intentionally omitted:
    //   id_token_signing_alg_values_supported, jwks_uri
  });
}

function trimTrailing(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
