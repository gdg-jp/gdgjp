import { isOrganizerPlus } from "~/features/chapters/permissions";
import { MembershipsSection } from "~/features/dashboard/components/memberships-section";
import {
  GoogleWorkspaceLink,
  MemberSimpleOidcLink,
  RoleToolsSection,
} from "~/features/dashboard/components/role-tools";
import { loadDashboard } from "~/features/dashboard/dashboard.server";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/dashboard";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadDashboard(args);
}

type PageProps = { loaderData: RouteData<typeof loadDashboard> };

export default function Dashboard({ loaderData }: PageProps) {
  const { user, memberships } = loaderData;
  const canRegisterApps = memberships.some((membership) => membership.status === "active");
  const organizerMemberships = memberships.filter(
    (membership) => membership.status === "active" && membership.role === "organizer",
  );
  const organizerChrome = isOrganizerPlus(user, memberships);

  return (
    <PageShell user={user} size="lg">
      <div>
        <MembershipsSection memberships={memberships} compact={!organizerChrome} />
        <GoogleWorkspaceLink />
      </div>
      {organizerChrome ? (
        <RoleToolsSection
          user={user}
          canRegisterApps={canRegisterApps}
          organizerMemberships={organizerMemberships}
        />
      ) : canRegisterApps ? (
        <MemberSimpleOidcLink />
      ) : null}
    </PageShell>
  );
}
