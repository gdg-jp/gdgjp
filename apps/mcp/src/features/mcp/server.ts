import { OAuthResourceServer } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import type { Env } from "../../env";
import { MCP_SCOPES } from "../oauth/scopes";
import { type AuthProps, authorizationServer, mcpResource } from "../oauth/server";
import { wikiClient } from "../wiki/client";
import { registerWikiTools } from "../wiki/tools";

export const SERVER_NAME = "gdg-japan";
export const SERVER_VERSION = "1.0.0";

const INSTRUCTIONS = `GDG Japan MCP: tools for GDG Japan services, acting as the signed-in GDG Japan Accounts user.

Wiki (wiki.gdgs.jp):
- Find knowledge with wiki_search, then read hits with wiki_read_page (space + slug). wiki_ls / wiki_cat / wiki_grep browse the same pages as a file tree.
- Everything is filtered to what this user may see; never assume a missing page does not exist.
- Pages are written by the knowledge runner, not by people or this server. To change what the wiki knows, add material with wiki_add_source (a URL) or wiki_add_inline_source (Markdown); the runner reads it into pages.
- Cite page URLs from tool results when answering.`;

/** One MCP server per request (stateless Streamable HTTP), bound to this request's grant. */
export function createServer(env: Env, props: AuthProps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  const wikiOrigin = new URL(env.WIKI_URL).origin;
  registerWikiTools(
    server,
    wikiClient({
      fetcher: env.WIKI ?? { fetch: (input: string, init?: RequestInit) => fetch(input, init) },
      origin: wikiOrigin,
      accessToken: props.upstream.accessToken,
    }),
    { wikiOrigin },
  );
  return server;
}

const resourceServers = new Map<string, OAuthResourceServer<Env, AuthProps>>();

/**
 * `/mcp` and its RFC 9728 metadata. Requests without a valid token for this resource get a
 * 401 challenge naming the authorization server; tools that need `wiki:write` answer a
 * read-only token with a 403 step-up challenge (`scopeChallenge`).
 */
export function resourceServer(env: Env): OAuthResourceServer<Env, AuthProps> {
  const resource = mcpResource(env);
  let server = resourceServers.get(resource);
  if (!server) {
    const issuer = new URL(env.APP_URL).origin;
    server = new OAuthResourceServer<Env, AuthProps>({
      resourceMetadata: {
        resource,
        authorization_servers: [issuer],
        resource_name: "GDG Japan MCP",
      },
      // Clients ask for both up front; the consent page lets the person leave out write.
      requiredScopes: [...MCP_SCOPES],
      validateToken: (env) => (resource, token) =>
        authorizationServer(env).validateToken<AuthProps>(resource, token, env),
      handler: {
        fetch(request, env, ctx) {
          const handler = createMcpHandler(() => createServer(env, ctx.props), {
            route: "/mcp",
            allowedHostnames: [new URL(env.APP_URL).hostname],
          });
          return handler(request, env, ctx);
        },
      },
    });
    resourceServers.set(resource, server);
  }
  return server;
}
