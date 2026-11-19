import { createRequestHandler } from "react-router";
import { runMeetCron } from "../app/features/cron/cron.server";
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
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runMeetCron(env));
  },
} satisfies ExportedHandler<Env>;
