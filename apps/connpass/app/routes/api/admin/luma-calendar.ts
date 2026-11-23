import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "~/features/auth/authorize.server";
import { connpassIdentity } from "~/features/auth/bearer.server";

const CALENDAR_API_ID = /^cal-[A-Za-z0-9]+$/;

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { env } = context.cloudflare;
  const identity = await connpassIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  if (!requireAdmin(identity)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const calendarId = (params.calendarId ?? "").trim();
  if (!CALENDAR_API_ID.test(calendarId)) {
    return Response.json({ error: "invalid_calendar_id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const chapterId =
    body && typeof body.chapterId === "string"
      ? body.chapterId
      : body && typeof body.chapterId === "number"
        ? String(body.chapterId)
        : null;
  const enabled = body && typeof body.enabled === "boolean" ? (body.enabled ? 1 : 0) : 1;

  await env.DB.prepare(
    `INSERT INTO luma_calendars (calendar_api_id, chapter_id, enabled, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(calendar_api_id) DO UPDATE SET
       chapter_id = excluded.chapter_id,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  )
    .bind(calendarId, chapterId, enabled)
    .run();

  return Response.json({ calendarId, chapterId, enabled: enabled === 1 });
}
