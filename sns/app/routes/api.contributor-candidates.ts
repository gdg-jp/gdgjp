import { requireSnsAccess } from "~/lib/access.server";
import type { Route } from "./+types/api.contributor-candidates";

type UserRow = {
  email: string;
  name: string;
  image: string | null;
};

/** Returns signed-in SNS users who can be added as contributors. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  if (access.chapter.role !== "organizer") throw new Response("Forbidden", { status: 403 });

  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const pattern = `%${query}%`;
  const result = await context.cloudflare.env.DB.prepare(
    `SELECT account_user.email, account_user.name, account_user.image
     FROM "user" AS account_user
     WHERE (? = '' OR account_user.name LIKE ? COLLATE NOCASE OR account_user.email LIKE ? COLLATE NOCASE)
       AND NOT EXISTS (
         SELECT 1 FROM sns_contributors
         WHERE sns_contributors.chapter_id = ? AND sns_contributors.user_email = account_user.email
       )
     ORDER BY account_user.name COLLATE NOCASE, account_user.email COLLATE NOCASE
     LIMIT 12`,
  )
    .bind(query, pattern, pattern, access.chapter.chapterId)
    .all<UserRow>();

  return Response.json({
    candidates: result.results.map((user) => ({
      email: user.email,
      name: user.name,
      image: user.image,
    })),
  });
}
