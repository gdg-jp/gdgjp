import { OAuthAuthorizationServer, OAuthError } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../../env";
import { UpstreamGrantError, type UpstreamTokens, accessTokenTtl, refreshTokens } from "./accounts";
import { MCP_SCOPES } from "./scopes";

/**
 * What a grant carries, encrypted by workers-oauth-provider with a key wrapped by the token
 * itself. Tools act with `upstream.accessToken`; nothing here is ever sent to the MCP client.
 */
export type AuthProps = {
  /** GDG Japan Accounts subject (`sub`). Also the grant's `userId`. */
  userId: string;
  email: string;
  name: string;
  upstream: UpstreamTokens;
};

/** Accounts' refresh tokens live 30 days and rotate on use; the grant slides with them. */
const GRANT_IDLE_TTL_SECONDS = 30 * 24 * 60 * 60;

export function mcpResource(env: Pick<Env, "APP_URL">): string {
  return `${new URL(env.APP_URL).origin}/mcp`;
}

const servers = new Map<string, OAuthAuthorizationServer<Env>>();

/** One authorization server per origin (production has one; tests and dev use localhost). */
export function authorizationServer(env: Pick<Env, "APP_URL">): OAuthAuthorizationServer<Env> {
  const issuer = new URL(env.APP_URL).origin;
  let server = servers.get(issuer);
  if (!server) {
    server = new OAuthAuthorizationServer<Env>({
      issuer,
      resources: [mcpResource(env)],
      scopesSupported: [...MCP_SCOPES],
      // MCP 2026-07-28 prefers Client ID Metadata Documents; DCR stays for older clients.
      clientIdMetadataDocumentEnabled: true,
      clientRegistrationEndpoint: "/oauth/register",
      refreshTokenIdleTTL: GRANT_IDLE_TTL_SECONDS,
      tokenExchangeCallback,
    });
    servers.set(issuer, server);
  }
  return server;
}

/**
 * Keeps each MCP access token inside the lifetime of the Accounts token it carries, and
 * refreshes that Accounts token whenever the MCP client refreshes. Accounts saying
 * `invalid_grant` revokes this grant too, so the client signs in again instead of retrying.
 */
export async function tokenExchangeCallback(options: {
  grantType: string;
  props: unknown;
  env: Env;
}) {
  const props = options.props as AuthProps;
  if (options.grantType === "authorization_code") {
    return { accessTokenTTL: accessTokenTtl(props.upstream) };
  }
  if (options.grantType !== "refresh_token") return undefined;
  let upstream: UpstreamTokens;
  try {
    upstream = await refreshTokens(options.env, props.upstream.refreshToken);
  } catch (error) {
    if (error instanceof UpstreamGrantError) {
      throw new OAuthError("invalid_grant", {
        description: "GDG Japan Accounts のサインインが切れました。もう一度接続してください。",
      });
    }
    throw new OAuthError("temporarily_unavailable", {
      description: "GDG Japan Accounts に接続できません。",
      statusCode: 503,
    });
  }
  const newProps: AuthProps = { ...props, upstream };
  return { newProps, accessTokenTTL: accessTokenTtl(upstream) };
}
