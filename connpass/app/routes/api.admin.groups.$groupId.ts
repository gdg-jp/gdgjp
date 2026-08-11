import type { ActionFunctionArgs } from "react-router";
import { requireAdmin, resolveGroupSlug } from "~/lib/authorize.server";
import { getCliIdentity } from "~/lib/cli-identity.server";

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  if (!requireAdmin(identity)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const groupSlug = resolveGroupSlug(params.groupId ?? "");
  if (!groupSlug) return Response.json({ error: "group_id_required" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const chapterId =
    body && typeof body.chapterId === "string"
      ? body.chapterId
      : body && typeof body.chapterId === "number"
        ? String(body.chapterId)
        : null;
  const numericGroupId =
    body && typeof body.numericGroupId === "number" ? body.numericGroupId : null;
  const enabled = body && typeof body.enabled === "boolean" ? (body.enabled ? 1 : 0) : 1;

  await env.DB.prepare(
    `INSERT INTO groups (group_slug, group_id, chapter_id, enabled, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(group_slug) DO UPDATE SET
       group_id = excluded.group_id,
       chapter_id = excluded.chapter_id,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  )
    .bind(groupSlug, numericGroupId, chapterId, enabled)
    .run();

  return Response.json({
    groupId: groupSlug,
    numericGroupId,
    chapterId,
    enabled: enabled === 1,
  });
}
