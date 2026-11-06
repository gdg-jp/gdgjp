import { requireUserWithChapter } from "~/features/auth/access.server";

/** /playbook/proposals is for organizers: their own chapters' proposals (admins see their chapters too). */
export async function requireOrganizer(env: Env, request: Request) {
  const { user, chapters } = await requireUserWithChapter(env, request);
  const chapterIds = chapters
    .filter((c) => c.role === "organizer" || user.isAdmin)
    .map((c) => c.chapterId);
  if (!chapterIds.length) throw new Response("Forbidden", { status: 403 });
  return { user, chapters, chapterIds };
}

/** The digest feedback.mjs compares against (canonical JSON of the parsed file). */
export async function digestJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
