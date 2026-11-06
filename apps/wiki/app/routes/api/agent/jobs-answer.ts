import type { ActionFunctionArgs } from "react-router";
import { isAgentService, resolveAgentReader } from "~/features/agent-api/agent-reader.server";
import { enqueueAnswer, validateBundle } from "~/features/jobs/answer.server";
import { getDb } from "~/lib/db.server";

/**
 * POST /api/agent/jobs/answer { question, spaces, bundle } — agent Worker only
 * (X-Agent-Service-Token), on behalf of the reader in Authorization / X-Agent-Principal.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  if (!isAgentService(request, env)) return Response.json({ error: "forbidden" }, { status: 403 });
  const db = getDb(env);
  const reader = await resolveAgentReader(request, env, db);
  if (!reader) return Response.json({ error: "invalid_token" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    spaces?: unknown;
    bundle?: unknown;
  } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const bundle = validateBundle(body?.bundle);
  if (!question || !bundle) return Response.json({ error: "invalid_request" }, { status: 400 });
  const spaces = Array.isArray(body?.spaces)
    ? body.spaces.filter((s): s is string => typeof s === "string")
    : [];
  return Response.json(await enqueueAnswer(env, db, reader, { question, spaces, bundle }));
}
