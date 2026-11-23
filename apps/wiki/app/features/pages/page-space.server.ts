import { type SQL, and, eq, inArray, ne } from "drizzle-orm";
import { pages } from "~/db/schema";

export function pageInSpace(spaceId: string, slug: string): SQL {
  return and(eq(pages.spaceId, spaceId), eq(pages.slug, slug)) as SQL;
}

export function pagesInSpaces(spaceIds: readonly string[]): SQL {
  if (spaceIds.length === 0) return eq(pages.id, "\u0000no-space");
  return inArray(pages.spaceId, [...spaceIds]);
}

export function agentPagesFilter(hideAgentPages: boolean): SQL | undefined {
  return hideAgentPages ? ne(pages.origin, "agent") : undefined;
}
