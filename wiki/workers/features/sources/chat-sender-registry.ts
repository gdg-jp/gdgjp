import { sql } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";

export const MAX_SENDER_SAMPLES = 10;
const USER_RESOURCE_NAME = /^users\/[A-Za-z0-9_-]+$/;

export function isChatSenderResourceName(value: string): boolean {
  return USER_RESOURCE_NAME.test(value);
}

/** Keep at most MAX_SENDER_SAMPLES rows per resource_name (fixed bind count). */
export function pruneSenderSamplesStatement(db: ReturnType<typeof getDb>, resourceName: string) {
  return db.delete(schema.googleChatSenderSamples).where(
    sql`resource_name = ${resourceName}
      AND id NOT IN (
        SELECT id FROM google_chat_sender_samples
        WHERE resource_name = ${resourceName}
        ORDER BY created_at DESC, id DESC
        LIMIT ${sql.raw(String(MAX_SENDER_SAMPLES))}
      )`,
  );
}

/** Persist a manual Chat sender display name. Does not rewrite source documents. */
export async function saveChatSenderName(
  env: Env,
  resourceName: string,
  displayName: string,
): Promise<void> {
  const db = getDb(env);
  const now = new Date();
  await db
    .insert(schema.googleChatSenderProfiles)
    .values({ resourceName, displayName, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.googleChatSenderProfiles.resourceName,
      set: { displayName, updatedAt: now },
    });
}
