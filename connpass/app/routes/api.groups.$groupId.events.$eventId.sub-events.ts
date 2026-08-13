import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "~/lib/authorize.server";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { listSubEventsInBrowser } from "~/lib/connpass-browser-read.server";
import { createJob, jobToJson } from "~/lib/jobs.server";
import type { components } from "../../openapi/types.generated";

type SubEvent = components["schemas"]["SubEvent"];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const groupSlug = resolveGroupSlug(params.groupId ?? "");
  const group = await getAllowedGroup(env.DB, groupSlug);
  if (!group || !canReadGroup(identity, group)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const eventId = params.eventId;
  if (!eventId) return Response.json({ error: "not_found" }, { status: 404 });

  try {
    const subEvents: SubEvent[] = await listSubEventsInBrowser(env, eventId);
    return Response.json({
      groupId: group.groupSlug,
      eventId,
      resultsReturned: subEvents.length,
      subEvents,
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
  const { env, ctx } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const groupSlug = resolveGroupSlug(params.groupId ?? "");
  const group = await getAllowedGroup(env.DB, groupSlug);
  if (!group || !canWriteGroup(identity, group)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const eventId = params.eventId;
  if (!eventId) return Response.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return Response.json({ error: "title_required" }, { status: 400 });
  }

  const job = await createJob(
    env,
    {
      type: "create_sub_event",
      groupSlug: group.groupSlug,
      eventId,
      createdBy: identity.user.id,
      request: { title: body.title.trim() },
    },
    ctx,
  );

  return Response.json(jobToJson(job), { status: 202 });
}
