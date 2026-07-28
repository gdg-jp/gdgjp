import { redirect } from "react-router";
import { requireSnsAccess } from "~/lib/access.server";
import { nowIso } from "~/lib/utils";
import type { Route } from "./+types/settings.x";
export async function action({ request, context }: Route.ActionArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (form.get("intent") !== "revoke" || !id) throw new Response("Bad request", { status: 400 });
  const result = await context.cloudflare.env.DB.prepare(
    "UPDATE x_accounts SET revoked_at = ?, updated_at = ? WHERE id = ? AND chapter_id = ?",
  )
    .bind(nowIso(), nowIso(), id, access.chapter.chapterId)
    .run();
  if (result.meta.changes !== 1) throw new Response("Not found", { status: 404 });
  throw redirect("/settings");
}
