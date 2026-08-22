import type { ActionFunctionArgs } from "react-router";
import { authorizeEventRoute } from "~/lib/event-route.server";
import { createJob, jobToJson } from "~/lib/jobs.server";

export async function action(args: ActionFunctionArgs) {
  if (args.request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const access = await authorizeEventRoute(args, true);
  if ("error" in access) return access.error;
  const job = await createJob(
    access.env,
    {
      type: "copy_event",
      groupSlug: access.group.groupSlug,
      eventId: access.eventId,
      request: {},
      createdBy: access.identity.user.id,
    },
    access.ctx,
  );
  return Response.json(jobToJson(job), { status: 202 });
}
