import { Card, Text, toast } from "@gdgjp/design-system";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { PageHeader } from "~/components/page-header";
import { ConnectedAppCard } from "~/features/oauth/components/connected-app-card";
import { actOnConnectedApps, loadConnectedApps } from "~/features/oauth/connected-apps.server";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/settings.connected-apps";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadConnectedApps(args);
}

export function action(args: Route.ActionArgs) {
  return actOnConnectedApps(args);
}

type PageProps = { loaderData: RouteData<typeof loadConnectedApps> };

export default function ConnectedApps({ loaderData }: PageProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnConnectedApps>();

  useEffect(() => {
    if (fetcher.data?.ok) toast.success(t("settings.connectedApps.removed"));
  }, [fetcher.data, t]);

  return (
    <PageShell size="md">
      <PageHeader
        title={t("settings.connectedApps.title")}
        description={t("settings.connectedApps.description")}
      />
      {loaderData.apps.length === 0 ? (
        <Card className="mt-6">
          <Text tone="muted">{t("settings.connectedApps.empty")}</Text>
        </Card>
      ) : (
        <ul className="mt-6 space-y-4">
          {loaderData.apps.map((app) => (
            <li key={app.clientId}>
              <ConnectedAppCard app={app} locale={loaderData.locale} fetcher={fetcher} />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
