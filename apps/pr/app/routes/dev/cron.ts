import { HOURLY_CRON, MINUTE_CRON, WEEKLY_CRON, runCron } from "~/features/cron/cron.server";
import type { Route } from "./+types/cron";
import { isLocalDev } from "./local";

/** Local dev / e2e: run a cron now. `/dev/cron?name=minute|hourly|weekly`. 404 elsewhere. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (!isLocalDev(env, request)) throw new Response(null, { status: 404 });
  const name = new URL(request.url).searchParams.get("name");
  const cron =
    name === "hourly"
      ? HOURLY_CRON
      : name === "minute"
        ? MINUTE_CRON
        : name === "weekly"
          ? WEEKLY_CRON
          : null;
  if (!cron) return Response.json({ error: "name=minute|hourly|weekly" }, { status: 400 });
  return Response.json(await runCron(env, cron));
}
