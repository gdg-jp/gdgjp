import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { accountsBaseUrl } from "~/lib/accounts-url.server";
import {
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "~/lib/authorize.server";
import { listSubEventsInBrowser } from "~/lib/connpass-browser-read.server";
import { createJob, jobToJson } from "~/lib/jobs.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getBearerIdentity(request, accountsBaseUrl(env));
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const groupSlug = resolveGroupSlug(params.groupId ?? "");
  const group = await getAllowedGroup(env.DB, groupSlug);
  if (!group || !canReadGroup(identity, group)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const eventId = params.eventId;
  const subEventId = params.subEventId;
  if (!eventId || !subEventId) return Response.json({ error: "not_found" }, { status: 404 });

  try {
    const subEvents = await listSubEventsInBrowser(env, eventId);
    const subEvent = subEvents.find((s) => s.id === subEventId);
    if (!subEvent) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ groupId: group.groupSlug, eventId, subEvent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connpass_browser_error";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "DELETE") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { env, ctx } = context.cloudflare;
  const identity = await getBearerIdentity(request, accountsBaseUrl(env));
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const groupSlug = resolveGroupSlug(params.groupId ?? "");
  const group = await getAllowedGroup(env.DB, groupSlug);
  if (!group || !canWriteGroup(identity, group)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const subEventId = params.subEventId;
  if (!subEventId) return Response.json({ error: "not_found" }, { status: 404 });

  const job = await createJob(
    env,
    {
      type: "delete_sub_event",
      groupSlug: group.groupSlug,
      eventId: subEventId,
      createdBy: identity.user.id,
      request: {},
    },
    ctx,
  );

  return Response.json(jobToJson(job), { status: 202 });
}
