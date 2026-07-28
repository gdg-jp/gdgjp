import { redirect } from "react-router";
import { requireSnsAccess } from "~/lib/access.server";
import { nowIso } from "~/lib/utils";
import type { Route } from "./+types/settings.x";
export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const xUserId = String(form.get("xUserId") ?? "");
  if (form.get("intent") !== "revoke" || !id || !xUserId)
    throw new Response("Bad request", { status: 400 });
  const result = await context.cloudflare.env.DB.prepare(
    "UPDATE x_accounts SET revoked_at = ?, updated_at = ? WHERE id = ? AND chapter_id = ? AND x_user_id = ?",
  )
    .bind(nowIso(), nowIso(), id, access.chapter.chapterId, xUserId)
    .run();
  if (result.meta.changes !== 1)
    throw new Response("X Account ID confirmation does not match", { status: 400 });
  throw redirect("/settings");
}
