import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { accountsBaseUrl } from "~/lib/accounts-url.server";
import {
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "~/lib/authorize.server";
import { getEventInBrowser } from "~/lib/connpass-browser-read.server";
import { parseEventWriteFields } from "~/lib/connpass-ui/events";
import { createJob, jobToJson } from "~/lib/jobs.server";
import type { components } from "../../openapi/types.generated";

type Event = components["schemas"]["Event"];

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
  if (!eventId) return Response.json({ error: "not_found" }, { status: 404 });

  try {
    const detail = await getEventInBrowser(env, eventId);
    // EventFields declares startAt/endAt/capacity as plain (non-nullable) optional
    // properties; connpass drafts can leave these unset, so map null -> omitted.
    const event: Event = {
      ...detail,
      startAt: detail.startAt ?? undefined,
      endAt: detail.endAt ?? undefined,
      capacity: detail.capacity ?? undefined,
    };
    return Response.json({ groupId: group.groupSlug, event });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connpass_browser_error";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "DELETE") {
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

  const eventId = params.eventId;
  if (!eventId) return Response.json({ error: "not_found" }, { status: 404 });

  if (request.method === "DELETE") {
    const job = await createJob(
      env,
      {
        type: "delete_event_draft",
        groupSlug: group.groupSlug,
        eventId,
        createdBy: identity.user.id,
        request: {},
      },
      ctx,
    );
    return Response.json(jobToJson(job), { status: 202 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = parseEventWriteFields(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  if (Object.values(parsed.fields).every((value) => value === undefined)) {
    return Response.json({ error: "event_fields_required" }, { status: 400 });
  }

  const job = await createJob(
    env,
    {
      type: "update_event",
      groupSlug: group.groupSlug,
      eventId,
      createdBy: identity.user.id,
      request: parsed.fields,
    },
    ctx,
  );

  return Response.json(jobToJson(job), { status: 202 });
}
