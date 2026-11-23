export function canHumanEditPage(page: { origin: string | null | undefined }): boolean {
  return page.origin !== "agent";
}

export const AGENT_PAGE_LOCKED = "agent_page_locked";
