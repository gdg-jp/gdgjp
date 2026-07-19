import { KeyRound, Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DeveloperAccessRequired, type DeveloperClientView } from "~/components/developer-apps";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
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
    <TableRow>
      <TableCell className="min-w-48 font-medium">
        <Link
          to={`/developers/apps/${encodeURIComponent(client.clientId)}`}
          prefetch="intent"
          className="text-primary hover:underline"
        >
          {client.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{createdAt}</TableCell>
      <TableCell>{t("developerApps.fields.webApplication")}</TableCell>
      <TableCell>
        <span className="block max-w-52 truncate font-mono text-xs" title={client.clientId}>
          {client.clientId}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={client.disabled ? "secondary" : "default"}>
          {client.disabled ? t("developerApps.status.disabled") : t("developerApps.status.active")}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <Button asChild variant="ghost" size="icon-sm">
          <Link
            to={`/developers/apps/${encodeURIComponent(client.clientId)}`}
            prefetch="intent"
            aria-label={t("developerApps.list.manageClient", { name: client.name })}
          >
            <Pencil className="size-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ClientsEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[34rem] items-start justify-center px-4 pt-24 text-center sm:pt-28">
      <div className="flex max-w-md flex-col items-center">
        <div className="relative mb-7 h-32 w-36" aria-hidden="true">
          <div className="absolute left-8 top-1 h-24 w-24 rotate-3 rounded-xl border-2 border-dashed border-gdg-green" />
          <div className="absolute left-[4.4rem] top-0 grid size-7 place-items-center rounded-full bg-background text-foreground">
            <KeyRound className="size-5" />
          </div>
          <div className="absolute bottom-0 left-1/2 h-14 w-16 -translate-x-1/2 rounded-t-lg border-2 border-b-0 border-foreground" />
          <div className="absolute bottom-0 left-[2.9rem] h-12 w-0.5 -rotate-[25deg] bg-foreground" />
          <div className="absolute bottom-0 right-[2.9rem] h-12 w-0.5 rotate-[25deg] bg-foreground" />
        </div>
        <h2 className="text-xl font-medium tracking-tight">{t("developerApps.list.emptyTitle")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("developerApps.list.emptyDescription")}
        </p>
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
                  <Plus className="size-4" /> {t("developerApps.list.create")}
                </Link>
              </Button>
            </div>
            <h2 className="mb-3 text-xl font-medium tracking-tight">
              {t("developerApps.list.tableTitle")}
            </h2>
            <Table>
              <TableHeader className="bg-muted/70">
                <TableRow className="hover:bg-muted/70">
                  <TableHead>{t("developerApps.list.name")}</TableHead>
                  <TableHead>{t("developerApps.list.creationDate")}</TableHead>
                  <TableHead>{t("developerApps.list.type")}</TableHead>
                  <TableHead>{t("developerApps.list.clientId")}</TableHead>
                  <TableHead>{t("developerApps.list.status")}</TableHead>
                  <TableHead className="text-right">{t("developerApps.list.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loaderData.clients.map((client: DeveloperClientView) => (
                  <ClientRow key={client.clientId} client={client} locale={loaderData.locale} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
