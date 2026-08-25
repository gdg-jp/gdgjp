import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { accountsBaseUrl } from "~/lib/accounts-url.server";
import {
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "~/lib/authorize.server";
import { listGroupEventsInBrowser } from "~/lib/connpass-browser-read.server";
import { parseEventWriteFields } from "~/lib/connpass-ui/events";
import { createJob, jobToJson } from "~/lib/jobs.server";
import type { components } from "../../openapi/types.generated";

type EventSummary = components["schemas"]["EventSummary"];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getBearerIdentity(request, accountsBaseUrl(env));
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const groupSlug = resolveGroupSlug(params.groupId ?? "");
  const group = await getAllowedGroup(env.DB, groupSlug);
  if (!group || !canReadGroup(identity, group)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const scraped = await listGroupEventsInBrowser(env, group.groupSlug);
    // EventSummary declares startAt/endAt as required, non-nullable strings; the
    // public group event list only ever shows published/canceled events, which
    // always carry dates, so the `?? ""` fallback should never actually trigger.
    const events: EventSummary[] = scraped.map((event) => ({
      ...event,
      startAt: event.startAt ?? "",
      endAt: event.endAt ?? "",
    }));
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
  const { env, ctx } = context.cloudflare;
  const identity = await getBearerIdentity(request, accountsBaseUrl(env));
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
  const parsed = parseEventWriteFields(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const job = await createJob(
    env,
    {
      type: "create_event",
      groupSlug: group.groupSlug,
      createdBy: identity.user.id,
      request: { ...parsed.fields, title: body.title.trim() },
    },
    ctx,
  );

  return Response.json(jobToJson(job), { status: 202 });
}
