import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";

export function buildUserText(baseUserText: string, docTexts: string[]): string {
  return [baseUserText, ...docTexts].filter((t) => t.trim().length > 0).join("\n\n---\n\n");
}

export async function updateIngestionPhase(
  db: ReturnType<typeof drizzle>,
  sessionId: string,
  message: string,
): Promise<void> {
  await db
    .update(schema.ingestionSessions)
    .set({ phaseMessage: message, updatedAt: new Date() })
    .where(eq(schema.ingestionSessions.id, sessionId));
}
