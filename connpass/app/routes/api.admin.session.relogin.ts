import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "~/lib/authorize.server";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { createJob, jobToJson } from "~/lib/jobs.server";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  if (!requireAdmin(identity)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const job = await createJob(env, {
    type: "relogin",
    groupSlug: "_system",
    createdBy: identity.user.id,
    request: {},
  });

  return Response.json(jobToJson(job), { status: 202 });
}
