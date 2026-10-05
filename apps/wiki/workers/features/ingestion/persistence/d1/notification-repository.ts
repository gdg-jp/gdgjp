import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";

export interface IngestionNotification {
  id: string;
  userId: string;
  type: "ingestion_done" | "ingestion_error";
  titleJa: string;
  titleEn: string;
  refId: string;
  refUrl: string;
}

export interface NotificationRepository {
  createOnce(notification: IngestionNotification): Promise<boolean>;
  markEmailed(notificationId: string): Promise<void>;
}

/** Persists idempotency; delivery itself belongs to the Tool-layer notifier. */
export class D1NotificationRepository implements NotificationRepository {
  private readonly db;

  constructor(database: D1Database) {
    this.db = drizzle(database, { schema });
  }

  async createOnce(notification: IngestionNotification): Promise<boolean> {
    const result = await this.db
      .insert(schema.notifications)
      .values(notification)
      .onConflictDoNothing()
      .run();
    return result.meta.changes > 0;
  }

  async markEmailed(notificationId: string): Promise<void> {
    await this.db
      .update(schema.notifications)
      .set({ emailedAt: new Date() })
      .where(eq(schema.notifications.id, notificationId));
  }
}
