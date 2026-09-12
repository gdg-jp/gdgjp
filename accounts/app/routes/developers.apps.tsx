import { Badge, Button, Heading, IconButton, Icons, Table, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DeveloperAccessRequired, type DeveloperClientView } from "~/components/developer-apps";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { loadDeveloperAccess } from "~/lib/developer-access.server";
import { i18n } from "~/lib/i18n/i18n.server";
import { listDeveloperClients } from "~/lib/oauth-clients.server";
import type { Route } from "./+types/developers.apps";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const [t, locale] = await Promise.all([
    i18n.getFixedT(args.request),
    i18n.getLocale(args.request),
  ]);
  const access = await loadDeveloperAccess(env, args.request);
  const clients = access.eligible ? await listDeveloperClients(env, args.request) : [];
  return { ...access, clients, locale, title: t("meta.developerApps") };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

function ClientRow({ client, locale }: { client: DeveloperClientView; locale: string }) {
  const { t } = useTranslation();
  const createdAt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(client.createdAt),
  );
  return (
    <tr>
      <td className="min-w-48 font-medium">
        <Link
          to={`/developers/apps/${encodeURIComponent(client.clientId)}`}
          prefetch="intent"
          className="text-primary hover:underline"
        >
          {client.name}
        </Link>
      </td>
      <td className="text-muted">{createdAt}</td>
      <td>{t("developerApps.fields.webApplication")}</td>
      <td>
        <span className="block max-w-52 truncate font-mono text-xs" title={client.clientId}>
          {client.clientId}
        </span>
      </td>
      <td>
        <Badge tone={client.disabled ? "neutral" : "success"}>
          {client.disabled ? t("developerApps.status.disabled") : t("developerApps.status.active")}
        </Badge>
      </td>
      <td className="text-right">
        <IconButton
          asChild
          variant="ghost"
          aria-label={t("developerApps.list.manageClient", { name: client.name })}
        >
          <Link to={`/developers/apps/${encodeURIComponent(client.clientId)}`} prefetch="intent">
            <Icons name="SquarePen" size={16} aria-hidden="true" />
          </Link>
        </IconButton>
      </td>
    </tr>
  );
}

function ClientsEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="developer-empty-state flex items-start justify-center px-4 pt-24 text-center sm:pt-28">
      <div className="flex max-w-md flex-col items-center">
        <div className="relative mb-7 h-32 w-36" aria-hidden="true">
          <div className="absolute left-8 top-1 h-24 w-24 rotate-3 rounded-xl border-2 border-dashed border-gdg-green" />
          <div className="developer-empty-key absolute top-0 grid size-7 place-items-center rounded-full bg-background text-foreground">
            <Icons name="Key" size={20} aria-hidden="true" />
          </div>
          {/* gdg-ui-allow: semantic-color — intentional high-contrast illustration outline */}
          <div className="absolute bottom-0 left-1/2 h-14 w-16 -translate-x-1/2 rounded-t-lg border-2 border-b-0 border-foreground" />
          <div className="developer-empty-crane-left absolute bottom-0 h-12 w-0.5 bg-foreground" />
          <div className="developer-empty-crane-right absolute bottom-0 h-12 w-0.5 bg-foreground" />
        </div>
        <Heading level={2}>{t("developerApps.list.emptyTitle")}</Heading>
        <Text size="sm" tone="muted">
          {t("developerApps.list.emptyDescription")}
        </Text>
        <Button asChild className="mt-6">
          <Link to="/developers/apps/new">{t("developerApps.list.getStarted")}</Link>
        </Button>
      </div>
    </div>
  );
}

export default function DeveloperApps({ loaderData }: Route.ComponentProps) {
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
