import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { accountsBaseUrl } from "~/features/auth/accounts-url.server";
import {
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "~/features/auth/authorize.server";
import { getSurveyInBrowser } from "~/features/connpass/connpass-browser-read.server";
import { parseSurveyQuestions as parseQuestions } from "~/features/connpass/survey-questions";
import { jobToJson } from "~/features/jobs/job-presentation";
import { createJob } from "~/features/jobs/job-submission.server";
import type { components } from "../../../../openapi/types.generated";

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
    const survey: components["schemas"]["Survey"] = await getSurveyInBrowser(env, eventId);
    return Response.json({ groupId: group.groupSlug, eventId, survey });
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
  const questions = body ? parseQuestions(body.questions) : null;
  if (!questions) {
    return Response.json({ error: "invalid_questions" }, { status: 400 });
  }

  const job = await createJob(
    env,
    {
      type: "upsert_survey",
      groupSlug: group.groupSlug,
      eventId,
      createdBy: identity.user.id,
      request: { questions },
    },
    ctx,
  );

  return Response.json(jobToJson(job), { status: 202 });
}
