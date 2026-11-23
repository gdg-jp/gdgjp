import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "~/features/auth/authorize.server";
import { connpassIdentity } from "~/features/auth/bearer.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await connpassIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  if (!requireAdmin(identity)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  type GroupRow = {
    groupSlug: string;
    groupId: number | null;
    chapterId: string | null;
    enabled: number;
  };
  const { results } = await env.DB.prepare(
    `SELECT group_slug AS groupSlug, group_id AS groupId, chapter_id AS chapterId, enabled
     FROM groups ORDER BY group_slug ASC`,
  ).all();
  const groups = ((results ?? []) as GroupRow[]).map((row) => ({
    groupId: row.groupSlug,
    numericGroupId: row.groupId,
    chapterId: row.chapterId,
    enabled: row.enabled === 1,
  }));

  return Response.json({ groups });
}
