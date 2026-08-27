import { createRequestHandler } from "react-router";
import type {
  DomainJobQueueMessage,
  DomainJobQueueMessageHandle,
} from "../app/features/domains/domain-job-runner.server";
import { serveCliInstaller } from "../app/lib/cli-installer.server";
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
    const installer = await serveCliInstaller(request, env.ASSETS);
    if (installer) return installer;
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
  async queue(batch, env, ctx) {
    const { processDomainJobQueueBatch } = await import(
      "../app/features/domains/domain-job-runner.server"
    );
    const { createDomainProvider } = await import("../app/features/domains");
    const { detectCustomDomain } = await import("../app/lib/domain-detection");
    const deps = { db: env.DB, provider: createDomainProvider(env), detectCustomDomain };
    const messages: DomainJobQueueMessageHandle[] = batch.messages.map((message) => ({
      body: message.body as DomainJobQueueMessage,
      ack: () => message.ack(),
      retry: (options) => message.retry(options),
    }));
    await processDomainJobQueueBatch(deps, messages);
  },
} satisfies ExportedHandler<Env>;
