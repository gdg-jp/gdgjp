import { ClaimsUnavailableError, isSuperAdmin } from "@gdgjp/gdg-lib";
import { requireSnsAccess } from "~/features/auth/access.server";
import { getAuth } from "~/features/auth/auth.server";
import { canAdministerContributors } from "~/features/contributors/contributor-policy";
import type {
  ContributorCandidate,
  ContributorCandidateSearch,
} from "~/features/contributors/contributor.types";

function candidateResponse(search: ContributorCandidateSearch, status = 200): Response {
  return Response.json(search, { status });
}

export async function searchContributorCandidates(request: Request, env: Env) {
  const access = await requireSnsAccess(env, request);
  if (
    !canAdministerContributors({
      role: access.chapter.role,
      isSuperAdmin: isSuperAdmin(access.user),
    })
  )
    throw new Response("Forbidden", { status: 403 });

  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
  if (!query) return candidateResponse({ candidates: [], error: null });

  let accessToken: string;
  try {
    accessToken = await getAuth(env).getAccessToken(request);
  } catch (error) {
    if (error instanceof ClaimsUnavailableError)
      return candidateResponse({ candidates: [], error: "accounts_sign_in_required" }, 401);
    throw error;
  }
  const users = await searchAccountsUsers(env, accessToken, query);
  if (!users) return candidateResponse({ candidates: [], error: "accounts_search_failed" }, 502);
  const contributorRows = await env.DB.prepare(
    "SELECT user_email FROM sns_contributors WHERE chapter_id = ?",
  )
    .bind(access.chapter.chapterId)
    .all<{ user_email: string }>();
  const contributors = new Set(contributorRows.results.map((row) => row.user_email.toLowerCase()));

  return candidateResponse({
    candidates: users.filter((user) => !contributors.has(user.email.toLowerCase())),
    error: null,
  });
}

async function searchAccountsUsers(
  env: Env,
  accessToken: string,
  query: string,
): Promise<ContributorCandidate[] | null> {
  const url = new URL("/api/users/search", env.ACCOUNTS_URL);
  url.searchParams.set("q", query);
  try {
    const response = await env.ACCOUNTS.fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      console.error("Accounts user search failed", response.status);
      return null;
    }
    const users = parseUsers(await response.json());
    if (!users) console.error("Accounts user search returned an invalid response");
    return users;
  } catch (error) {
    console.error("Accounts user search failed", error);
    return null;
  }
}

function parseUsers(payload: unknown): ContributorCandidate[] | null {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { users?: unknown }).users)
  ) {
    return null;
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
