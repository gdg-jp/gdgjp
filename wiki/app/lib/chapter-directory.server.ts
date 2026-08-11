export type DirectoryChapter = {
  id: string;
  slug: string;
  name: string;
  kind: "gdg" | "gdgoc";
};

/**
 * Public chapter directory from Accounts — same source ShareDialog uses.
 * Wiki's local `chapters` table is not kept in sync with memberships, so
 * pickers that need real chapter options must call this instead.
 */
export async function loadChapterDirectory(
  env: { ACCOUNTS_URL: string },
  query = "",
): Promise<DirectoryChapter[]> {
  const url = new URL("/api/chapters/directory", env.ACCOUNTS_URL);
  if (query) url.searchParams.set("q", query);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`accounts chapter directory returned ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { chapters?: unknown }).chapters)
  ) {
    throw new Error("accounts chapter directory returned an invalid payload");
  }
  return (payload as { chapters: unknown[] }).chapters.flatMap((chapter) => {
    if (!chapter || typeof chapter !== "object") return [];
    const value = chapter as Record<string, unknown>;
    if (
      typeof value.id !== "string" ||
      typeof value.slug !== "string" ||
      typeof value.name !== "string" ||
      (value.kind !== "gdg" && value.kind !== "gdgoc")
    ) {
      return [];
    }
    return [{ id: value.id, slug: value.slug, name: value.name, kind: value.kind }];
  });
}
