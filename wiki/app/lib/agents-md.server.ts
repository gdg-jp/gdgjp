import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";
import draft from "../../../docs/plans/03a-agents-md.md?raw";

export type AgentInstructions = {
  content: string;
  contentHash: string;
};

export function agentsHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const seedMatch = /````markdown\n([\s\S]*?)\n````/.exec(draft);
if (!seedMatch) throw new Error("AGENTS.md seed is missing its Markdown fence");
/** Migration/bootstrap value only; database content is authoritative after initialization. */
export const INITIAL_AGENTS_MD = `${seedMatch[1]}\n`;

export async function getAgentInstructions(
  db: ReturnType<typeof getDb>,
): Promise<AgentInstructions | null> {
  let row = await db
    .select()
    .from(schema.wikiAgentInstructions)
    .where(eq(schema.wikiAgentInstructions.id, 1))
    .get();
  if (!row) {
    // Older production databases contain an administrator but not necessarily
    // the optional wiki-system row introduced by the namespace seed migration.
    // Use a real admin so this bootstrap satisfies the foreign-key constraint.
    const seedUser = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.isAdmin, true))
      .get();
    if (!seedUser) return null;
    const contentHash = agentsHash(INITIAL_AGENTS_MD);
    await db
      .insert(schema.wikiAgentInstructions)
      .values({ id: 1, content: INITIAL_AGENTS_MD, contentHash, updatedBy: seedUser.id })
      .onConflictDoNothing();
    row = await db
      .select()
      .from(schema.wikiAgentInstructions)
      .where(eq(schema.wikiAgentInstructions.id, 1))
      .get();
  }
  return row ? { content: row.content, contentHash: row.contentHash } : null;
}
