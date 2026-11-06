import type { ActionFunctionArgs } from "react-router";
import { resolveAgentReader } from "~/features/agent-api/agent-reader.server";
import { requireSpaceForIdentity } from "~/features/spaces/access.server";
import { upsertSpaceMember } from "~/features/spaces/members.server";
import { getDb } from "~/lib/db.server";

/**
 * POST /api/agent/spaces/:space/members { principalType, principalId } — the agent's
 * `/setup`: an OWNER (their own token, never the service token) makes a Discord guild or
 * Chat space a viewer of a shared space. Personal and chapter spaces refuse these principals.
 */
export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env);
  const reader = await resolveAgentReader(request, env, db);
  if (!reader || reader.via !== "user")
    return Response.json({ error: "invalid_token" }, { status: 401 });
  let space: Awaited<ReturnType<typeof requireSpaceForIdentity>>["space"];
  try {
    ({ space } = await requireSpaceForIdentity(db, reader.identity, params.space ?? "", "owner"));
  } catch (response) {
    if (response instanceof Response)
      return Response.json({ error: "forbidden" }, { status: response.status });
    throw response;
  }
  const body = (await request.json().catch(() => null)) as {
    principalType?: unknown;
    principalId?: unknown;
  } | null;
  const principalType = String(body?.principalType ?? "");
  if (principalType !== "discord_guild" && principalType !== "chat_space") {
    return Response.json({ error: "principal_not_allowed" }, { status: 400 });
  }
  const result = await upsertSpaceMember(db, space, {
    principalType,
    principalId: String(body?.principalId ?? ""),
    role: "viewer",
  });
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: result.error }, { status: result.status });
}
