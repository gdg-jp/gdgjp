import { Button, Heading, Icons, Table } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PageHeader } from "~/components/page-header";
import { ClientRow, ClientsEmptyState } from "~/features/developer-apps/components/client-list";
import {
  DeveloperAccessRequired,
  type DeveloperClientView,
} from "~/features/developer-apps/components/developer-apps";
import { loadDevelopersApps } from "~/features/developer-apps/developers-apps.server";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/developers.apps";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadDevelopersApps(args);
}

type PageProps = { loaderData: RouteData<typeof loadDevelopersApps> };

export default function DeveloperApps({ loaderData }: PageProps) {
  const { t } = useTranslation();
  return (
    <PageShell user={loaderData.user} size="lg">
      <PageHeader title={t("developerApps.list.title")} />
      <div>
        {!loaderData.eligible ? (
          <div className="pt-7">
            <DeveloperAccessRequired user={loaderData.user} />
          </div>
        ) : loaderData.clients.length === 0 ? (
          <ClientsEmptyState />
        ) : (
          <div className="pt-5">
            <div className="mb-8 flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost" className="-ml-3 text-primary hover:text-primary">
                <Link to="/developers/apps/new">
                  <Icons name="Plus" size={16} aria-hidden="true" />{" "}
                  {t("developerApps.list.create")}
                </Link>
              </Button>
            </div>
            <Heading level={2} className="mb-3">
              {t("developerApps.list.tableTitle")}
            </Heading>
            <Table scrollLabel={t("common.tableScroll")}>
              <thead>
                <tr>
                  <th>{t("developerApps.list.name")}</th>
                  <th>{t("developerApps.list.creationDate")}</th>
                  <th>{t("developerApps.list.type")}</th>
                  <th>{t("developerApps.list.clientId")}</th>
                  <th>{t("developerApps.list.status")}</th>
                  <th className="text-right">{t("developerApps.list.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {loaderData.clients.map((client: DeveloperClientView) => (
                  <ClientRow key={client.clientId} client={client} locale={loaderData.locale} />
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
