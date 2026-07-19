import { ArrowLeft, ArrowRight, Blocks, ExternalLink, Globe2, Plus } from "lucide-react";
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
      <Card className="transition-shadow hover:shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{client.name}</CardTitle>
              {client.appUrl ? (
                <a
                  href={client.appUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  <Globe2 className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{client.appUrl}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <Badge variant={client.disabled ? "secondary" : "default"}>
              {client.disabled
                ? t("developerApps.status.disabled")
                : t("developerApps.status.active")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("developerApps.list.clientId")}</dt>
              <dd className="max-w-48 truncate font-mono" title={client.clientId}>
                {client.clientId}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("developerApps.list.createdAt", { date: createdAt })}
              </dt>
              <dd>{t("developerApps.list.scopeCount", { count: client.scopes.length })}</dd>
            </div>
          </dl>
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
    <PageShell user={loaderData.user} size="lg">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/dashboard" prefetch="intent">
          <ArrowLeft className="size-4" /> {t("nav.backToDashboard")}
        </Link>
      </Button>
      <div className="flex flex-wrap items-end justify-between gap-4">
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
      <div className="mt-8">
        {!loaderData.eligible ? (
          <DeveloperAccessRequired user={loaderData.user} />
        ) : loaderData.clients.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader className="items-start gap-4 sm:flex-row">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-gdg-blue/10 text-gdg-blue">
                <Blocks className="size-5" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <CardTitle>{t("developerApps.list.emptyTitle")}</CardTitle>
                <CardDescription>{t("developerApps.list.emptyDescription")}</CardDescription>
              </div>
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
