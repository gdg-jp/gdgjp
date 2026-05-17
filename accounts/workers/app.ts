import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createRequestHandler } from "react-router";
import { buildOAuthOptions } from "../app/lib/oauth-provider.server";
import { CloudflareContext } from "./context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

const rrHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return requestHandler(request, new CloudflareContext({ env, ctx }));
  },
};

// Instantiated lazily so appUrl can be read from env at runtime.
let providerCache: { provider: OAuthProvider<Env>; appUrl: string } | null = null;

function getProvider(env: Env): OAuthProvider<Env> {
  if (providerCache?.appUrl === env.APP_URL) return providerCache.provider;
  const provider = new OAuthProvider<Env>(
    buildOAuthOptions({ appUrl: env.APP_URL, defaultHandler: rrHandler }),
  );
  providerCache = { provider, appUrl: env.APP_URL };
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
