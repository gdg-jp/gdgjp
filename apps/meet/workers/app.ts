import { createRequestHandler } from "react-router";
import { processMeetJobBatch } from "../app/features/jobs/registry.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
  async queue(batch, env, ctx) {
    await processMeetJobBatch(batch, env, ctx);
  },
} satisfies ExportedHandler<Env>;
