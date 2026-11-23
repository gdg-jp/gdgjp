import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  Heading,
  Icons,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import type { FetcherWithComponents } from "react-router";
import type { ConnectedApp } from "~/features/oauth/connected-apps.server";
import { scopeLabelKeys } from "~/features/oauth/scope-labels";

export function ConnectedAppCard({
  app,
  locale,
  fetcher,
}: {
  app: ConnectedApp;
  locale: string;
  fetcher: FetcherWithComponents<unknown>;
}) {
  const { t } = useTranslation();
  const isRemoving = fetcher.state !== "idle" && fetcher.formData?.get("clientId") === app.clientId;
  const scopeLabels = scopeLabelKeys(app.scopes);
  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        )
      : t("settings.connectedApps.notRecorded");

  return (
    <Card>
      <Stack className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading level={2} className="text-base">
            {app.name}
          </Heading>
          {app.disabled ? (
            <Badge tone="warning">{t("settings.connectedApps.disabled")}</Badge>
          ) : null}
        </div>
        {app.ownerName ? (
          <Text size="sm" tone="muted">
            {t("auth.consent.owner", { ownerName: app.ownerName })}
          </Text>
        ) : null}
        {app.appUrl ? (
          <a
            href={app.appUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            <span className="truncate">{app.appUrl}</span>
            <Icons name="ArrowUpRight" size={14} className="shrink-0" aria-hidden="true" />
          </a>
        ) : null}
      </Stack>

      <section className="mt-4" aria-label={t("settings.connectedApps.permissions")}>
        <Text size="sm" className="font-medium">
          {t("settings.connectedApps.permissions")}
        </Text>
        <ul className="mt-2 space-y-1 text-sm">
          {scopeLabels.map((label) => (
            <li key={label} className="flex items-start gap-2">
              <Icons name="Check" size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t(label)}</span>
            </li>
          ))}
        </ul>
      </section>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">{t("settings.connectedApps.grantedAt")}</dt>
          <dd className="text-muted">{formatDate(app.grantedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("settings.connectedApps.lastTokenAt")}</dt>
          <dd className="text-muted">{formatDate(app.lastTokenAt)}</dd>
        </div>
      </dl>

      <div className="mt-6 flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" loading={isRemoving}>
              <Icons name="Delete" size={16} aria-hidden="true" />
              {t("settings.connectedApps.remove")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <Stack className="gap-2">
              <AlertDialogTitle>
                {t("settings.connectedApps.removeConfirmTitle", { appName: app.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings.connectedApps.removeConfirmDescription")}
              </AlertDialogDescription>
            </Stack>
            <div className="flex flex-wrap justify-end gap-3">
              <AlertDialogCancel asChild>
                <Button type="button" variant="outline">
                  {t("settings.connectedApps.cancel")}
                </Button>
              </AlertDialogCancel>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="clientId" value={app.clientId} />
                <AlertDialogAction asChild>
                  <Button type="submit" variant="danger" loading={isRemoving}>
                    {t("settings.connectedApps.remove")}
                  </Button>
                </AlertDialogAction>
              </fetcher.Form>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
}
