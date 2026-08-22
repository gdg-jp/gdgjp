import type { ActionFunctionArgs } from "react-router";
import { authorizeEventRoute } from "~/lib/event-route.server";
import { createJob, jobToJson } from "~/lib/jobs.server";

export async function action(args: ActionFunctionArgs) {
  if (args.request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const access = await authorizeEventRoute(args, true);
  if ("error" in access) return access.error;
  const body = (await args.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.subject !== "string" || typeof body.body !== "string")
    return Response.json({ error: "invalid_body" }, { status: 400 });
  const job = await createJob(
    access.env,
    {
      type: "send_event_message",
      groupSlug: access.group.groupSlug,
      eventId: access.eventId,
      request: { subject: body.subject, body: body.body, recipients: body.recipients },
      createdBy: access.identity.user.id,
    },
    access.ctx,
  );
  return Response.json(jobToJson(job), { status: 202 });
}
