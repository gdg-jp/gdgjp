import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { getCliIdentity } from "@gdgjp/gdg-lib";

export type CliActor = { user: AuthUser; chapters: UserChapter[] };

export type CliAuthResult = { ok: true; actor: CliActor } | { ok: false; response: Response };

export async function requireCliActor(env: Env, request: Request): Promise<CliAuthResult> {
  const identity = await getCliIdentity(request, env.ACCOUNTS_URL);
  if (!identity) {
    return {
      ok: false,
      response: Response.json(
        { error: "The bearer token is missing, invalid, or lacks the CLI scope." },
        { status: 401 },
      ),
    };
  }
  return { ok: true, actor: { user: identity.user, chapters: identity.chapters } };
}
