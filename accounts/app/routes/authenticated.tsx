import type { AuthUser } from "@gdgjp/gdg-lib";
import { Outlet } from "react-router";
import { DashboardShell } from "~/components/dashboard-shell";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import { listMembershipsForUser } from "~/lib/db";
import type { Route } from "./+types/authenticated";

/**
 * The authenticated application boundary. Individual routes still authorize
 * their own reads and mutations; this loader exists to keep the global account
 * navigation consistent and avoid asking every screen to assemble it.
 */
export async function loader(args: Route.LoaderArgs) {
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

export default function AuthenticatedLayout({ loaderData }: Route.ComponentProps) {
  return (
    <DashboardShell user={loaderData.user} memberships={loaderData.memberships}>
      <Outlet />
    </DashboardShell>
  );
}
