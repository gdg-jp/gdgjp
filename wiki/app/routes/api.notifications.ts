import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const notifications = await db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      titleJa: schema.notifications.titleJa,
      titleEn: schema.notifications.titleEn,
      refId: schema.notifications.refId,
      refUrl: schema.notifications.refUrl,
      readAt: schema.notifications.readAt,
      createdAt: schema.notifications.createdAt,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50)
    .all();

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)))
    .get();

  return Response.json({
    notifications,
    unreadCount: countResult?.count ?? 0,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env);

  const body = (await request.json()) as { notificationId?: string; markAllRead?: boolean };
  const now = new Date();

  if (body.markAllRead) {
    await db
      .update(schema.notifications)
      .set({ readAt: now })
      .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
    return Response.json({ ok: true });
  }

  if (body.notificationId) {
    await db
      .update(schema.notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(schema.notifications.id, body.notificationId),
          eq(schema.notifications.userId, user.id),
        ),
      );
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Invalid request" }, { status: 400 });
}
