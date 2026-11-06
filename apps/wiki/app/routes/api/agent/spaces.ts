import type { LoaderFunctionArgs } from "react-router";
import { readerMaySeeSpace, resolveAgentReader } from "~/features/agent-api/agent-reader.server";
import { listAccessibleSpaces, resolveSpaceAccess } from "~/features/spaces/access.server";
import { getDb } from "~/lib/db.server";

/** GET /api/agent/spaces — the reader's reachable spaces and role (agent `/setup`). */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env);
  const reader = await resolveAgentReader(request, env, db);
  if (!reader) return Response.json({ error: "invalid_token" }, { status: 401 });
  const access = await resolveSpaceAccess(db, reader.identity, reader.extraPrincipals);
  const spaces = (await listAccessibleSpaces(db, access)).filter((space) =>
    readerMaySeeSpace(reader, space.slug),
  );
  return Response.json({
    spaces: spaces.map((space) => ({
      id: space.id,
      slug: space.slug,
      name: space.name,
      kind: space.kind,
      role: space.role,
    })),
  });
}
