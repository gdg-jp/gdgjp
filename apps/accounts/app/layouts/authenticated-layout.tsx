import { Outlet } from "react-router";
import type { loadAuthenticated } from "~/features/auth/authenticated.server";
import { DashboardShell } from "~/layouts/dashboard-shell";
import type { RouteData } from "~/lib/route-data";
type PageProps = { loaderData: RouteData<typeof loadAuthenticated> };

export default function AuthenticatedLayout({ loaderData }: PageProps) {
  return (
    <DashboardShell user={loaderData.user} memberships={loaderData.memberships}>
      <Outlet />
    </DashboardShell>
  );
}
