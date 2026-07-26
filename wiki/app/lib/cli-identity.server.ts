/** Identity for a non-browser CLI request. Accounts owns token validation. */
export type CliIdentity = {
  user: { id: string; email: string; name: string; image: string | null; isAdmin: boolean };
  chapters: Array<{ chapterId: string | number; chapterSlug: string; role: string }>;
};

export async function getCliIdentity(request: Request, env: Env): Promise<CliIdentity | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(new URL("/api/cli/identity", env.ACCOUNTS_URL), {
    headers: { authorization },
  });
  if (!response.ok) return null;
  const value = (await response.json()) as CliIdentity;
  if (!value?.user?.id || !Array.isArray(value.chapters)) return null;
  return value;
}
