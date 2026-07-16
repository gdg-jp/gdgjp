import type { AuthUser } from "@gdgjp/gdg-lib";
import { buildSignInRedirect } from "./auth-redirect";
import { requireUser } from "./auth.server";
import { requireDeveloperAccess } from "./oauth-clients.server";

export async function loadDeveloperAccess(
  env: Env,
  request: Request,
): Promise<{ user: AuthUser; eligible: boolean }> {
  let user: AuthUser;
  try {
    user = await requireUser(env, request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) throw buildSignInRedirect(request);
    throw error;
  }
  try {
    await requireDeveloperAccess(env, request);
    return { user, eligible: true };
  } catch (error) {
    if (error instanceof Response && error.status === 403) return { user, eligible: false };
    throw error;
  }
}
