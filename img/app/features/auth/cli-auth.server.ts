import { getCliIdentity } from "@gdgjp/gdg-lib";
import type { Actor } from "./actor";

export type CliAuthResult = { ok: true; actor: Actor } | { ok: false; response: Response };

export async function requireCliActor(env: Env, request: Request): Promise<CliAuthResult> {
  const identity = await getCliIdentity(request, env.ACCOUNTS_URL);
  if (!identity) {
    return { ok: false, response: Response.json({ error: "invalid_token" }, { status: 401 }) };
  }
  return { ok: true, actor: { user: identity.user, chapters: identity.chapters } };
}
