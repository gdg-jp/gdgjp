import type { Env } from "./env";
import { landingPage } from "./features/mcp/landing";
import { resourceServer } from "./features/mcp/server";
import { handleAuthorize, handleCallback } from "./features/oauth/authorize";
import { authorizationServer } from "./features/oauth/server";

/**
 * Routes. `/authorize` and `/callback` are ours (consent, then GDG Japan Accounts sign-in);
 * `/mcp` and `/.well-known/oauth-protected-resource/*` belong to the resource server; every
 * other OAuth endpoint (`/.well-known/oauth-authorization-server`, `/oauth/token`,
 * `/oauth/register`) is served by workers-oauth-provider.
 */
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/authorize") return handleAuthorize(request, env);
    if (pathname === "/callback") return handleCallback(request, env);
    if (pathname === "/" && request.method === "GET") return landingPage(env);
    if (
      pathname === "/mcp" ||
      pathname.startsWith("/mcp/") ||
      pathname.startsWith("/.well-known/oauth-protected-resource")
    ) {
      return resourceServer(env).fetch(request, env, ctx);
    }
    return authorizationServer(env).fetch(request, env, ctx);
  },

  async scheduled(_controller, env): Promise<void> {
    await authorizationServer(env).purgeExpiredData(env);
  },
} satisfies ExportedHandler<Env>;
