import { WorkerEntrypoint } from "cloudflare:workers";
import type { TinyurlPrService } from "@gdgjp/gdg-lib";
import { createRequestHandler } from "react-router";
import {
  prCreateLink,
  prEnsureCampaign,
  prEnsureChannel,
  prGetAnalytics,
  prUpdateLink,
} from "../app/features/campaigns/pr-service.server";
import { serveCliInstaller } from "../app/features/cli-api/cli-installer.server";
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

/** pr.gdgs.jp's service binding (`entrypoint = "PrService"`). Each call authorizes its actor. */
export class PrService extends WorkerEntrypoint<Env> implements TinyurlPrService {
  ensureCampaign(input: Parameters<TinyurlPrService["ensureCampaign"]>[0]) {
    return prEnsureCampaign(this.env, input);
  }
  ensureChannel(input: Parameters<TinyurlPrService["ensureChannel"]>[0]) {
    return prEnsureChannel(this.env, input);
  }
  createLink(input: Parameters<TinyurlPrService["createLink"]>[0]) {
    return prCreateLink(this.env, input);
  }
  updateLink(input: Parameters<TinyurlPrService["updateLink"]>[0]) {
    return prUpdateLink(this.env, input);
  }
  getAnalytics(input: Parameters<TinyurlPrService["getAnalytics"]>[0]) {
    return prGetAnalytics(this.env, input);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const installer = await serveCliInstaller(request, env.ASSETS);
    if (installer) return installer;
    if (url.pathname.startsWith("/api/internal/gateway/")) {
      const { handleGatewayInternalRequest } = await import(
        "../app/features/domains/gateway-internal"
      );
      return handleGatewayInternalRequest(request, env, ctx);
    }
    const apex = isApexRedirect(request, env);
    if (apex) {
      const { handleApexRedirect } = await import("../app/features/links/redirect-handler");
      const response = await handleApexRedirect(env, ctx, request, apex.slug, apex.hostname);
      if (response) return response;
    }
    return requestHandler(request, new CloudflareContext({ env, ctx }));
  },
} satisfies ExportedHandler<Env>;
