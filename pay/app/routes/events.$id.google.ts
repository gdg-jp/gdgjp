import { canViewAllClaims, requireMember } from "~/lib/auth-redirect.server";
import { getEvent, markTemplateGranted, setEventGoogleFolder } from "~/lib/db.server";
import {
  getAccessibleGoogleDriveItem,
  getValidGoogleAccessToken,
  isGoogleDriveFolder,
  isGoogleSpreadsheet,
} from "~/lib/google-oauth.server";
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
    const fileId = String(form.get("fileId") ?? "");
    if (fileId !== env.SHEETS_TEMPLATE_ID) {
      return Response.json({ error: "指定されたテンプレートを選択してください" }, { status: 400 });
    }
    try {
      const accessToken = await getValidGoogleAccessToken(env, user.id);
      const item = await getAccessibleGoogleDriveItem(accessToken, fileId);
      if (!isGoogleSpreadsheet(item)) {
        return Response.json({ error: "スプレッドシートを選択してください" }, { status: 400 });
      }
      await markTemplateGranted(env.DB, user.id);
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "テンプレートを確認できませんでした" },
        { status: 400 },
      );
    }
  }

  if (intent === "set-folder") {
    const folderId = String(form.get("folderId") ?? "");
    if (!folderId) {
      return Response.json({ error: "フォルダを選択してください" }, { status: 400 });
    }
    try {
      const accessToken = await getValidGoogleAccessToken(env, user.id);
      const item = await getAccessibleGoogleDriveItem(accessToken, folderId);
      if (!isGoogleDriveFolder(item)) {
        return Response.json({ error: "Google Driveフォルダを選択してください" }, { status: 400 });
      }
      await setEventGoogleFolder(env.DB, event.id, { id: item.id, name: item.name });
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "フォルダを確認できませんでした" },
        { status: 400 },
      );
    }
  }

  return Response.json({ error: "不明な操作です" }, { status: 400 });
}
