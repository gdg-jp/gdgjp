import type { ActionFunctionArgs } from "react-router";
import { getParticipantsInBrowser } from "~/lib/connpass-browser-read.server";
import { authorizeEventRoute } from "~/lib/event-route.server";
import { createJob, jobToJson } from "~/lib/jobs.server";

export async function loader(args: ActionFunctionArgs) {
  const access = await authorizeEventRoute(args, false);
  if ("error" in access) return access.error;
  const participant = (await getParticipantsInBrowser(access.env, access.eventId)).find(
    (item) => item.id === args.params.participantId,
  );
  return participant
    ? Response.json({ participant })
    : Response.json({ error: "not_found" }, { status: 404 });
}

export async function action(args: ActionFunctionArgs) {
  if (args.request.method !== "PATCH")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const access = await authorizeEventRoute(args, true);
  if ("error" in access) return access.error;
  const participantId = args.params.participantId;
  const input = await args.request.json().catch(() => null);
  if (!participantId || !input || typeof input !== "object")
    return Response.json({ error: "invalid_body" }, { status: 400 });
  const job = await createJob(
    access.env,
    {
      type: "update_participant",
      groupSlug: access.group.groupSlug,
      eventId: access.eventId,
      request: { participantId, input },
      createdBy: access.identity.user.id,
    },
    access.ctx,
  );
  return Response.json(jobToJson(job), { status: 202 });
}
