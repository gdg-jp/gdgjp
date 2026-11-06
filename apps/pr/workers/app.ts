import { createRequestHandler } from "react-router";
import { requeueExpired } from "../app/features/jobs/job.repository.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

/** Every minute. Keep in sync with [triggers] crons in wrangler.toml. */
export const MINUTE_CRON = "* * * * *";

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
  async scheduled(event, env, ctx) {
    if (event.cron === MINUTE_CRON) {
      ctx.waitUntil(
        requeueExpired(env.DB).catch((error) => console.error("[scheduled] requeue failed", error)),
      );
    }
  },
} satisfies ExportedHandler<Env>;
