import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "~/features/auth/authorize.server";
import { connpassIdentity } from "~/features/auth/bearer.server";
import { jobToJson } from "~/features/jobs/job-presentation";
import { createJob } from "~/features/jobs/job-submission.server";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { env, ctx } = context.cloudflare;
  const identity = await connpassIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  if (!requireAdmin(identity)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const job = await createJob(
    env,
    {
      type: "relogin",
      groupSlug: "_system",
      createdBy: identity.user.id,
      request: {},
    },
    ctx,
  );

  return Response.json(jobToJson(job), { status: 202 });
}
