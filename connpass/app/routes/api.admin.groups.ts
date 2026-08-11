import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "~/lib/authorize.server";
import { getCliIdentity } from "~/lib/cli-identity.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  if (!requireAdmin(identity)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { results } = await env.DB.prepare(
    `SELECT group_slug AS groupSlug, group_id AS groupId, chapter_id AS chapterId, enabled
     FROM groups ORDER BY group_slug ASC`,
  ).all<{
    groupSlug: string;
    groupId: number | null;
    chapterId: string | null;
    enabled: number;
  }>();

  return Response.json({
    groups: (results ?? []).map((row) => ({
      groupId: row.groupSlug,
      numericGroupId: row.groupId,
      chapterId: row.chapterId,
      enabled: row.enabled === 1,
    })),
  });
}
