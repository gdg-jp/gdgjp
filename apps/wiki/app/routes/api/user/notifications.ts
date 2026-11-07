import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/features/auth/utils.server";
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
    // Read notifications fall off after 30 days, unread ones after 60: a two-month-old
    // "processing failed" with nothing to open is noise, not a task.
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        or(
          and(
            isNull(schema.notifications.readAt),
            gt(schema.notifications.createdAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)),
          ),
          gt(schema.notifications.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        ),
      ),
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50)
    .all();

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        isNull(schema.notifications.readAt),
        gt(schema.notifications.createdAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)),
      ),
    )
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
