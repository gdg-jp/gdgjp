import { redirect } from "react-router";
import { requireUserWithChapter } from "~/features/auth/access.server";
import { chapterCookie } from "~/features/auth/current-chapter";
import type { Route } from "./+types/chapter";

/** POST /chapter — the sidebar's chapter switcher. Lands on the events of the new chapter. */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { chapters } = await requireUserWithChapter(env, request);
  const id = Number((await request.formData()).get("chapterId"));
  if (!chapters.some((c) => c.chapterId === id)) throw new Response(null, { status: 400 });
  return redirect("/events", {
    headers: { "Set-Cookie": chapterCookie(id, new URL(request.url).protocol === "https:") },
  });
}

export function loader() {
  return redirect("/");
}
