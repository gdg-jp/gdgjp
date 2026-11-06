import { type SQL, and, eq, inArray, ne } from "drizzle-orm";
import { pages } from "~/db/schema";

/**
 * Slugs are unique per space only. Every slug lookup goes through this helper so it cannot
 * resolve a page in another space (tests/architecture/space-scoped-slug.test.ts).
 */
export function pageInSpace(spaceId: string, slug: string): SQL {
  return and(eq(pages.spaceId, spaceId), eq(pages.slug, slug)) as SQL;
}

/** Restrict a page listing to the given spaces. An empty list matches nothing. */
export function pagesInSpaces(spaceIds: readonly string[]): SQL {
  if (spaceIds.length === 0) return eq(pages.id, "\u0000no-space");
  return inArray(pages.spaceId, [...spaceIds]);
}

/**
 * The "hide agent-written pages" display preference (user_preferences.hide_agent_pages).
 * It removes origin=agent pages from discoverable surfaces only; it is not a permission.
 */
export function agentPagesFilter(hideAgentPages: boolean): SQL | undefined {
  return hideAgentPages ? ne(pages.origin, "agent") : undefined;
}
