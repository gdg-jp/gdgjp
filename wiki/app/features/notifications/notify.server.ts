import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { sendPushToUser } from "./fcm.server";

interface NotificationOpts {
  id: string;
  userId: string;
  type: string;
  titleJa: string;
  titleEn: string;
  refId?: string;
  refUrl?: string;
}

/**
 * Insert an in-app notification AND send a best-effort push notification.
 * If `ctx` is provided, push is dispatched via `waitUntil` to avoid blocking.
 */
export async function createNotification(
  env: Env,
  db: DrizzleD1Database<typeof schema>,
  opts: NotificationOpts,
  ctx?: ExecutionContext,
): Promise<void> {
  await db.insert(schema.notifications).values({
    id: opts.id,
    userId: opts.userId,
    type: opts.type,
    titleJa: opts.titleJa,
    titleEn: opts.titleEn,
    refId: opts.refId,
    refUrl: opts.refUrl,
    createdAt: new Date(),
  });

  const pushWork = sendPushToUser(
    env,
    opts.userId,
    { title: opts.titleJa, url: opts.refUrl },
    { title: opts.titleEn, url: opts.refUrl },
  ).catch((err) => {
    console.error("[notify] push notification failed:", err);
  });

  if (ctx) {
    ctx.waitUntil(pushWork);
  } else {
    await pushWork;
  }
}
