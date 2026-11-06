import { createRequestHandler } from "react-router";
import { runCron } from "../app/features/cron/cron.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, event.cron));
  },
} satisfies ExportedHandler<Env>;
