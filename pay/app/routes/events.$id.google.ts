import { canViewAllClaims, requireMember } from "~/lib/auth-redirect.server";
import { getEvent, markTemplateGranted, setEventGoogleFolder } from "~/lib/db.server";
import { getValidGoogleAccessToken } from "~/lib/google-oauth.server";
import { isEventId } from "~/lib/id";
import type { Route } from "./+types/events.$id.google";

async function assertManage(env: Env, request: Request, eventId: string) {
  if (!isEventId(eventId)) throw new Response("Not Found", { status: 404 });
  const { user, chapters } = await requireMember(env, request);
  const event = await getEvent(env.DB, eventId);
  if (!event) throw new Response("Not Found", { status: 404 });
  if (!canViewAllClaims({ userId: user.id, chapters }, event)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { user, event };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, event } = await assertManage(env, request, params.id);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (event.googleAdminUserId !== user.id) {
    return Response.json({ error: "自分が連携したイベントのみ操作できます" }, { status: 403 });
  }

  if (intent === "access-token") {
    try {
      const accessToken = await getValidGoogleAccessToken(env, user.id);
      return Response.json({ accessToken });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "アクセストークンの取得に失敗しました" },
        { status: 400 },
      );
    }
  }

  if (intent === "grant-template") {
    await markTemplateGranted(env.DB, user.id);
    return Response.json({ ok: true });
  }

  if (intent === "set-folder") {
    const folderId = String(form.get("folderId") ?? "");
    const folderName = String(form.get("folderName") ?? "");
    if (!folderId || !folderName) {
      return Response.json({ error: "フォルダを選択してください" }, { status: 400 });
    }
    await setEventGoogleFolder(env.DB, event.id, { id: folderId, name: folderName });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "不明な操作です" }, { status: 400 });
}
