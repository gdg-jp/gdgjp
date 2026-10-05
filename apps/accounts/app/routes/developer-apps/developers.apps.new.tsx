import { Alert, Button, Text } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { Form, Link, useNavigation } from "react-router";
import { PageHeader } from "~/components/page-header";
import {
  ClientSecret,
  DeveloperAccessRequired,
  DeveloperClientForm,
} from "~/features/developer-apps/components/developer-apps";
import {
  actOnDevelopersAppsNew,
  loadDevelopersAppsNew,
} from "~/features/developer-apps/developers-apps-new.server";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/developers.apps.new";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadDevelopersAppsNew(args);
}

export function action(args: Route.ActionArgs) {
  return actOnDevelopersAppsNew(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadDevelopersAppsNew>;
  actionData?: RouteData<typeof actOnDevelopersAppsNew>;
};

export default function NewDeveloperApp({ loaderData, actionData }: PageProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  return (
    <PageShell user={loaderData.user} size="lg">
      <PageHeader
        back={{ to: "/developers/apps", label: t("developerApps.back") }}
        title={t("developerApps.create.title")}
      />
      <div className="mt-7">
        {!loaderData.eligible ? (
          <DeveloperAccessRequired user={loaderData.user} />
        ) : actionData?.ok ? (
          <div className="space-y-4">
            <Alert tone="success" title={t("developerApps.create.submit")}>
              {t("developerApps.secret.description")}
            </Alert>
            <ClientSecret clientId={actionData.clientId} secret={actionData.clientSecret} />
            <Button asChild>
              <Link to={`/developers/apps/${encodeURIComponent(actionData.clientId)}`}>
                {t("developerApps.create.manage")}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="max-w-2xl">
            <Text size="sm" tone="muted" className="max-w-xl">
              {t("developerApps.create.subtitle")}
            </Text>
            <Form method="post" className="mt-7 space-y-10">
              <Alert tone="info" title={t("developerApps.create.beforeYouStart")}>
                {t("developerApps.create.beforeYouStartDescription")}
              </Alert>
              <div className="space-y-6">
                {actionData && !actionData.ok ? (
                  <Alert tone="danger" title={t("developerApps.errors.title")}>
                    {actionData.error}
                  </Alert>
                ) : null}
                <DeveloperClientForm variant="create" />
              </div>
              <Text size="sm" tone="muted">
                {t("developerApps.create.effectNote")}
              </Text>
              <div className="flex flex-wrap items-center gap-3 border-t pt-6">
                <Button type="submit" loading={pending}>
                  {t("developerApps.create.submit")}
                </Button>
                <Button asChild variant="ghost">
                  <Link to="/developers/apps">{t("developerApps.create.cancel")}</Link>
                </Button>
              </div>
            </Form>
          </div>
        )}
      </div>
    </PageShell>
  );
}
