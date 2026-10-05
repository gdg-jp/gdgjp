import type { AuthUser } from "@gdgjp/gdg-lib";
import { buildSignInRedirect } from "~/features/auth/auth-redirect";
import { requireUser } from "~/features/auth/auth.server";
import { listMembershipsForUser } from "~/features/memberships/repository.server";
import type { RouteRequestArgs } from "~/lib/route-args";
export async function loadAuthenticated(args: RouteRequestArgs) {
  const env = args.context.cloudflare.env;
  let user: AuthUser;
  try {
    user = await requireUser(env, args.request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw error;
  }

  const memberships = await listMembershipsForUser(env.DB, user.id);
  return { user, memberships };
}
