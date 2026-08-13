import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  canReadGroup,
  canWriteGroup,
  getAllowedGroup,
  resolveGroupSlug,
} from "~/lib/authorize.server";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { getSurveyInBrowser } from "~/lib/connpass-browser-read.server";
import type { SurveyQuestion } from "~/lib/connpass-ui/survey";
import { createJob, jobToJson } from "~/lib/jobs.server";
import type { components } from "../../openapi/types.generated";

const ANSWER_TYPES = new Set(["free_text", "checkbox", "radio", "dropdown"]);

function parseQuestions(value: unknown): SurveyQuestion[] | null {
  if (!Array.isArray(value)) return null;
  const questions: SurveyQuestion[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.title !== "string") return null;
    if (typeof item.answerType !== "string" || !ANSWER_TYPES.has(item.answerType)) return null;
    if (typeof item.required !== "boolean") return null;
    const options = Array.isArray(item.options)
      ? item.options.filter((o): o is string => typeof o === "string")
      : null;
    questions.push({
      title: item.title,
      answerType: item.answerType as SurveyQuestion["answerType"],
      required: item.required,
      options,
    });
  }
  return questions;
}

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
