import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";
import draft from "../../../../docs/plans/03a-agents-md.md?raw";

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

/**
 * Slice AGENTS.md by exact heading text up to the next heading of the same or
 * higher level. Used by the query filing profile so the answer path never sees
 * the full document.
 */
export function extractInstructionSections(
  markdown: string,
  headings: readonly string[],
): string | null {
  const lines = markdown.split("\n");
  const sections: string[] = [];

  for (const heading of headings) {
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start < 0) return null;
    const level = headingLevel(lines[start] ?? "");
    if (level === 0) return null;

    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      const nextLevel = headingLevel(lines[i] ?? "");
      if (nextLevel > 0 && nextLevel <= level) {
        end = i;
        break;
      }
    }
    const slice = lines.slice(start, end).join("\n").trim();
    if (!slice) return null;
    sections.push(slice);
  }

  const content = sections.join("\n\n").trim();
  return content.length > 0 ? `${content}\n` : null;
}

function headingLevel(line: string): number {
  const match = /^(#{1,6})\s+\S/.exec(line.trim());
  return match ? match[1].length : 0;
}

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
