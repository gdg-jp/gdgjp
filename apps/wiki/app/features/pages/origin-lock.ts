/**
 * Pages written by the agent are read-only for people (knowledge platform v2 §8-6): their
 * body and title are written only by the runner through `/sync`. People change them by
 * asking the agent ("ask the agent" on the page). Archive, move and sharing stay with people.
 *
 * Applied ON TOP of the page ACL (`getEffectivePagePermissions` is unchanged) at every
 * human write path: editor loader/action, collab socket, revert, image upload.
 * Pinned by tests/architecture/agent-page-lock.test.ts.
 */
export function canHumanEditPage(page: { origin: string | null | undefined }): boolean {
  return page.origin !== "agent";
}

export const AGENT_PAGE_LOCKED = "agent_page_locked";
