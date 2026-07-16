import { ArrowLeft, ArrowRight, Blocks, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DeveloperAccessRequired, type DeveloperClientView } from "~/components/developer-apps";
import { PageShell } from "~/components/page-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
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

function ClientCard({ client, locale }: { client: DeveloperClientView; locale: string }) {
  const { t } = useTranslation();
  const createdAt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(client.createdAt),
  );
  return (
    <li>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{client.name}</CardTitle>
              <CardDescription className="mt-1 truncate font-mono text-xs">
                {client.clientId}
              </CardDescription>
            </div>
            <Badge variant={client.disabled ? "secondary" : "default"}>
              {client.disabled
                ? t("developerApps.status.disabled")
                : t("developerApps.status.active")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {t("developerApps.list.createdAt", { date: createdAt })}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link to={`/developers/apps/${encodeURIComponent(client.clientId)}`} prefetch="intent">
              {t("developerApps.list.manage")} <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </li>
  );
}

export default function DeveloperApps({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <PageShell user={loaderData.user}>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/dashboard" prefetch="intent">
          <ArrowLeft className="size-4" /> {t("nav.backToDashboard")}
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Blocks className="size-6 text-gdg-blue" />
            <h1 className="text-3xl font-medium tracking-tight">{t("developerApps.list.title")}</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("developerApps.list.subtitle")}</p>
        </div>
        {loaderData.eligible ? (
          <Button asChild>
            <Link to="/developers/apps/new">
              <Plus className="size-4" /> {t("developerApps.list.create")}
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="mt-6">
        {!loaderData.eligible ? (
          <DeveloperAccessRequired user={loaderData.user} />
        ) : loaderData.clients.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("developerApps.list.emptyTitle")}</CardTitle>
              <CardDescription>{t("developerApps.list.emptyDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/developers/apps/new">{t("developerApps.list.create")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {loaderData.clients.map((client: DeveloperClientView) => (
              <ClientCard key={client.clientId} client={client} locale={loaderData.locale} />
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
