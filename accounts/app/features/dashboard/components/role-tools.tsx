import type { AuthUser } from "@gdgjp/gdg-lib";
import { Button, Card, Heading, Icons, Stack, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { loadDashboard } from "~/features/dashboard/dashboard.server";
import type { RouteData } from "~/lib/route-data";

type PageProps = { loaderData: RouteData<typeof loadDashboard> };
export function MemberSimpleOidcLink() {
  const { t } = useTranslation();
  return (
    <div className="mt-8 text-sm text-muted">
      <Link
        to="/developers/apps"
        prefetch="intent"
        className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
      >
        {t("dashboard.memberSimple.oidcLink")}{" "}
        <Icons name="ArrowRight" size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function GoogleWorkspaceLink() {
  const { t } = useTranslation();
  return (
    <div className="mt-4 text-sm text-muted">
      <Link
        to="/settings/google-workspace"
        prefetch="intent"
        className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
      >
        {t("dashboard.googleWorkspaceLink")}{" "}
        <Icons name="ArrowRight" size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function RoleToolsSection({
  user,
  canRegisterApps,
  organizerMemberships,
}: {
  user: AuthUser;
  canRegisterApps: boolean;
  organizerMemberships: PageProps["loaderData"]["memberships"];
}) {
  const { t } = useTranslation();
  if (!(canRegisterApps || organizerMemberships.length > 0 || user.isAdmin)) {
    return null;
  }
  return (
    <section aria-labelledby="role-tools-heading" className="mt-10 space-y-3">
      <div>
        <Heading level={2} id="role-tools-heading" className="text-lg">
          {t("dashboard.roleTools.heading")}
        </Heading>
        <Text size="sm" tone="muted">
          {t("dashboard.roleTools.description")}
        </Text>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {organizerMemberships.length > 0 ? (
          <Card>
            <Stack>
              <div className="flex items-center gap-2">
                <Icons name="Settings" size={16} aria-hidden="true" />
                <Heading level={3} className="text-base">
                  {t("dashboard.organizerTools.title")}
                </Heading>
              </div>
              <Text tone="muted">{t("dashboard.organizerTools.description")}</Text>
            </Stack>
            <div className="mt-6 flex flex-wrap gap-2">
              {organizerMemberships.map((membership) => (
                <Button asChild key={membership.chapterId} variant="outline" size="sm">
                  <Link to={`/chapters/${membership.chapter.slug}/organize`} prefetch="intent">
                    {membership.chapter.name}
                  </Link>
                </Button>
              ))}
            </div>
          </Card>
        ) : null}
        {canRegisterApps ? (
          <Card>
            <Stack>
              <div className="flex items-center gap-2">
                <Icons name="Key" size={16} aria-hidden="true" />
                <Heading level={3} className="text-base">
                  {t("dashboard.developerApps.title")}
                </Heading>
              </div>
              <Text tone="muted">{t("dashboard.developerApps.description")}</Text>
            </Stack>
            <div className="mt-6">
              <Button asChild variant="outline" size="sm">
                <Link to="/developers/apps" prefetch="intent">
                  {t("dashboard.developerApps.cta")}{" "}
                  <Icons name="ArrowRight" size={16} aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </Card>
        ) : null}
        {user.isAdmin ? (
          <Card className="md:col-span-2">
            <Stack>
              <div className="flex items-center gap-2">
                <Icons name="ShieldCheck" size={16} aria-hidden="true" />
                <Heading level={3} className="text-base">
                  {t("dashboard.superAdmin.title")}
                </Heading>
              </div>
              <Text tone="muted">{t("dashboard.superAdmin.description")}</Text>
            </Stack>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/users" prefetch="intent">
                  <Icons name="Users" size={16} aria-hidden="true" />{" "}
                  {t("dashboard.superAdmin.usersCta")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/requests" prefetch="intent">
                  <Icons name="List" size={16} aria-hidden="true" />{" "}
                  {t("dashboard.superAdmin.requestsCta")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/chapters" prefetch="intent">
                  {t("dashboard.superAdmin.manageCta")}
                </Link>
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
