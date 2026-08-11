import type { LoaderFunctionArgs } from "react-router";
import { canReadGroup, getAllowedGroup, resolveGroupSlug } from "~/lib/authorize.server";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { getJob, jobToJson } from "~/lib/jobs.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const jobId = params.jobId;
  if (!jobId) return Response.json({ error: "not_found" }, { status: 404 });

  const job = await getJob(env.DB, jobId);
  if (!job) return Response.json({ error: "not_found" }, { status: 404 });

  const group = await getAllowedGroup(env.DB, resolveGroupSlug(job.groupSlug));
  if (!group || !canReadGroup(identity, group)) {
    if (!identity.user.isAdmin && job.createdBy !== identity.user.id) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  return Response.json(jobToJson(job));
}
