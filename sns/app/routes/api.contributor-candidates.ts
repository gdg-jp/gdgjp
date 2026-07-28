import { requireSnsAccess } from "~/lib/access.server";
import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/api.contributor-candidates";

type UserRow = {
  email: string;
  name: string;
  image: string | null;
};

/** Returns Accounts users who can be added as contributors. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  if (access.chapter.role !== "organizer") throw new Response("Forbidden", { status: 403 });

  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
  if (!query) return Response.json({ candidates: [] });

  const [accessToken, contributorRows] = await Promise.all([
    getAuth(context.cloudflare.env).getAccessToken(request),
    context.cloudflare.env.DB.prepare(
      "SELECT user_email FROM sns_contributors WHERE chapter_id = ?",
    )
      .bind(access.chapter.chapterId)
      .all<{ user_email: string }>(),
  ]);
  const url = new URL("/api/users/search", context.cloudflare.env.ACCOUNTS_URL);
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    console.error("Accounts user search failed", response.status);
    throw new Response("Unable to search Accounts users", { status: 502 });
  }
  const payload: unknown = await response.json();
  const users = parseUsers(payload);
  const contributors = new Set(contributorRows.results.map((row) => row.user_email.toLowerCase()));

  return Response.json({
    candidates: users
      .filter((user) => !contributors.has(user.email.toLowerCase()))
      .map((user) => ({
        email: user.email,
        name: user.name,
        image: user.image,
      })),
  });
}

function parseUsers(payload: unknown): UserRow[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { users?: unknown }).users)
  ) {
    throw new Response("Invalid Accounts user search response", { status: 502 });
  }
  return (payload as { users: unknown[] }).users.flatMap((user) => {
    if (!user || typeof user !== "object") return [];
    const value = user as Record<string, unknown>;
    if (
      typeof value.email !== "string" ||
      typeof value.name !== "string" ||
      (value.image !== null && typeof value.image !== "string")
    ) {
      return [];
    }
    return [{ email: value.email, name: value.name, image: value.image }];
  });
}
