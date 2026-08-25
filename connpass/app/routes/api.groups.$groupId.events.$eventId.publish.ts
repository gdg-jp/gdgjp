import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { ActionFunctionArgs } from "react-router";
import { accountsBaseUrl } from "~/lib/accounts-url.server";
import { canWriteGroup, getAllowedGroup, resolveGroupSlug } from "~/lib/authorize.server";
import { createJob, jobToJson } from "~/lib/jobs.server";

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

  const eventId = params.eventId;
  if (!eventId) return Response.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const job = await createJob(
    env,
    {
      type: "publish_event",
      groupSlug: group.groupSlug,
      eventId,
      createdBy: identity.user.id,
      request: {
        postToTwitter: typeof body?.postToTwitter === "boolean" ? body.postToTwitter : undefined,
        comment: typeof body?.comment === "string" ? body.comment : undefined,
      },
    },
    ctx,
  );

  return Response.json(jobToJson(job), { status: 202 });
}
