import { createRequestHandler } from "react-router";
import { CloudflareContext } from "./context";

declare global {
  interface Env {
    CF_ACCOUNT_ID: string;
    CF_AE_API_TOKEN: string;
    VERCEL_TOKEN: string;
    VERCEL_PROJECT_ID: string;
    VERCEL_TEAM_ID?: string;
    GATEWAY_SHARED_SECRET: string;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

function isApexRedirect(request: Request, env: Env): { slug: string; hostname: string } | null {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const apexHost = new URL(env.SHORT_URL_BASE).host;
  if (host === apexHost || host === "go.gdgs.jp") {
    const slug = url.pathname.slice(1).split("/")[0];
    if (!slug) return null;
    return { slug, hostname: host };
  }
  if (url.pathname.startsWith("/r/")) {
    const slug = url.pathname.slice(3).split("/")[0];
    if (!slug) return null;
    return { slug, hostname: apexHost };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/internal/gateway/")) {
      const { handleGatewayInternalRequest } = await import("../app/lib/gateway-internal");
      return handleGatewayInternalRequest(request, env, ctx);
    }
    const apex = isApexRedirect(request, env);
    if (apex) {
      const { handleApexRedirect } = await import("../app/lib/redirect-handler");
      const response = await handleApexRedirect(env, ctx, request, apex.slug, apex.hostname);
      if (response) return response;
    }
    return requestHandler(request, new CloudflareContext({ env, ctx }));
  },
} satisfies ExportedHandler<Env>;
