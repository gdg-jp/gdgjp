import type { LoaderFunctionArgs } from "react-router";
import { getAgentInstructions } from "~/lib/agents-md.server";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { getDb } from "~/lib/db.server";

/** GET /api/cli/wiki/agents-md — centrally managed AGENTS.md for wiki clones. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const identity = await getCliIdentity(request, context.cloudflare.env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const agents = await getAgentInstructions(getDb(context.cloudflare.env));
  if (!agents) return Response.json({ error: "agents_md_unavailable" }, { status: 503 });
  return new Response(agents.content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      etag: `\"${agents.contentHash}\"`,
    },
  });
}
