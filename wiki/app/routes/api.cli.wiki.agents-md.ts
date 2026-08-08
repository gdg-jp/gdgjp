import type { LoaderFunctionArgs } from "react-router";
import { AGENTS_MD } from "~/lib/agents-md.server";
import { getCliIdentity } from "~/lib/cli-identity.server";

/** GET /api/cli/wiki/agents-md — centrally managed AGENTS.md for wiki clones. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const identity = await getCliIdentity(request, context.cloudflare.env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  return new Response(AGENTS_MD, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
