import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "~/lib/authorize.server";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { listGroupEventsInBrowser } from "~/lib/connpass-browser-read.server";
import { parseParticipationTypes } from "~/lib/connpass-ui/events";
import { createJob, jobToJson } from "~/lib/jobs.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const groupSlug = resolveGroupSlug(params.groupId ?? "");
  const group = await getAllowedGroup(env.DB, groupSlug);
  if (!group || !canReadGroup(identity, group)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const events = await listGroupEventsInBrowser(env, group.groupSlug);
    return Response.json({
      groupId: group.groupSlug,
      resultsReturned: events.length,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connpass_browser_error";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const groupSlug = resolveGroupSlug(params.groupId ?? "");
  const group = await getAllowedGroup(env.DB, groupSlug);
  if (!group || !canWriteGroup(identity, group)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return Response.json({ error: "title_required" }, { status: 400 });
  }

  const job = await createJob(env, {
    type: "create_event",
    groupSlug: group.groupSlug,
    createdBy: identity.user.id,
    request: {
      title: body.title.trim(),
      subtitle: typeof body.subtitle === "string" ? body.subtitle : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      startAt: typeof body.startAt === "string" ? body.startAt : undefined,
      endAt: typeof body.endAt === "string" ? body.endAt : undefined,
      place: typeof body.place === "string" ? body.place : undefined,
      address: typeof body.address === "string" ? body.address : undefined,
      capacity: typeof body.capacity === "number" ? body.capacity : undefined,
      reservedAt: typeof body.reservedAt === "string" ? body.reservedAt : undefined,
      registrationEnabled:
        typeof body.registrationEnabled === "boolean" ? body.registrationEnabled : undefined,
      participationTypes: parseParticipationTypes(body.participationTypes),
    },
  });

  return Response.json(jobToJson(job), { status: 202 });
}
