import { type AuthUser, type UserChapter, getCliIdentity } from "@gdgjp/gdg-lib";
import { cliError } from "./cli-http.server";

export type CliActor = { user: AuthUser; chapters: UserChapter[] };

export type CliAuthResult = { ok: true; actor: CliActor } | { ok: false; response: Response };

export async function requireCliActor(env: Env, request: Request): Promise<CliAuthResult> {
  const identity = await getCliIdentity(request, env.ACCOUNTS_URL);
  if (!identity) {
    return { ok: false, response: cliError("invalid_token", 401) };
  }
  return { ok: true, actor: { user: identity.user, chapters: identity.chapters } };
}
