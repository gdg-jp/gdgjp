import type { LoaderFunctionArgs } from "react-router";
import { isAgentService } from "~/features/agent-api/agent-reader.server";
import { latestRunnerHeartbeat } from "~/features/jobs/runner.server";
import { getDb } from "~/lib/db.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  if (!isAgentService(request, env)) return Response.json({ error: "forbidden" }, { status: 403 });
  const lastSeen = await latestRunnerHeartbeat(getDb(env));
  return Response.json({ lastSeenAt: lastSeen ? Math.floor(lastSeen.getTime() / 1000) : null });
}
