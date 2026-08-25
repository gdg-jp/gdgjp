import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { accountsBaseUrl } from "~/lib/accounts-url.server";
import {
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "~/lib/authorize.server";
import { getConferenceInBrowser } from "~/lib/connpass-browser-read.server";
import type { UpsertConferenceInput } from "~/lib/connpass-ui/conference";
import { createJob, jobToJson } from "~/lib/jobs.server";
import type { components } from "../../openapi/types.generated";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseConferenceBody(body: Record<string, unknown> | null): UpsertConferenceInput | null {
  if (!body || typeof body.isActive !== "boolean") return null;
  return {
    isActive: body.isActive,
    lpUrl: optionalString(body.lpUrl),
    cfpUrl: optionalString(body.cfpUrl),
    cfpStartAt: optionalString(body.cfpStartAt),
    cfpEndAt: optionalString(body.cfpEndAt),
    sponsorUrl: optionalString(body.sponsorUrl),
    sponsorStartAt: optionalString(body.sponsorStartAt),
    sponsorEndAt: optionalString(body.sponsorEndAt),
    topics: Array.isArray(body.topics)
      ? body.topics.filter((t): t is string => typeof t === "string")
      : undefined,
  };
}

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
    const conference: components["schemas"]["Conference"] = await getConferenceInBrowser(
      env,
      eventId,
    );
    return Response.json({ groupId: group.groupSlug, eventId, conference });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connpass_browser_error";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const conference = parseConferenceBody(body);
  if (!conference) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const job = await createJob(
    env,
    {
      type: "upsert_conference",
      groupSlug: group.groupSlug,
      eventId,
      createdBy: identity.user.id,
      request: conference,
    },
    ctx,
  );

  return Response.json(jobToJson(job), { status: 202 });
}
