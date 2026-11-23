import type { LoaderFunctionArgs } from "react-router";
import { isAgentService } from "~/features/agent-api/agent-reader.server";
import { getAnswerJob } from "~/features/jobs/answer.server";
import { getDb } from "~/lib/db.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  if (!isAgentService(request, env)) return Response.json({ error: "forbidden" }, { status: 403 });
  const job = await getAnswerJob(getDb(env), params.id ?? "");
  return job ? Response.json(job) : Response.json({ error: "not_found" }, { status: 404 });
}
