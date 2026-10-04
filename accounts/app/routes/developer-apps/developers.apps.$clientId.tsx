import { Alert, Badge, Button, Heading, Icons, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Form, Link, useNavigation } from "react-router";
import { PageHeader } from "~/components/page-header";
import { ConfirmAction } from "~/features/developer-apps/components/confirm-action";
import {
  ClientSecret,
  DeveloperAccessRequired,
  DeveloperClientForm,
  type DeveloperClientView,
} from "~/features/developer-apps/components/developer-apps";
import {
  actOnDevelopersAppsDetail,
  loadDevelopersAppsDetail,
} from "~/features/developer-apps/developers-apps-detail.server";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/developers.apps.$clientId";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadDevelopersAppsDetail(args);
}

export function action(args: Route.ActionArgs) {
  return actOnDevelopersAppsDetail(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadDevelopersAppsDetail>;
  actionData?: RouteData<typeof actOnDevelopersAppsDetail>;
};

export default function DeveloperAppDetail({ loaderData, actionData }: PageProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const client = loaderData.client as DeveloperClientView | null;
  const isUpdating = navigation.state !== "idle" && navigation.formData?.get("intent") === "update";
  const formatDate = (value: Date | string | number | undefined) =>
    value
      ? new Intl.DateTimeFormat(loaderData.locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : t("developerApps.detail.notAvailable");

  return (
    <PageShell user={loaderData.user} size="lg">
      <PageHeader
        back={{ to: "/developers/apps", label: t("developerApps.back") }}
        title={t("developerApps.detail.title")}
        actions={
          client ? (
            <ConfirmAction
              intent="delete"
              icon={<Icons name="Delete" size={16} aria-hidden="true" />}
              trigger={t("developerApps.detail.delete")}
              title={t("developerApps.dialog.deleteTitle")}
              description={t("developerApps.dialog.deleteDescription")}
              confirm={t("developerApps.dialog.deleteConfirm")}
              destructive
              toolbar
            />
          ) : null
        }
      />
      {!loaderData.eligible || !client ? (
        <div className="mt-6">
          <DeveloperAccessRequired user={loaderData.user} />
        </div>
      ) : (
        <>
          <div className="mt-6 space-y-5">
            {actionData?.ok &&
            actionData.intent === "rotate" &&
            actionData.clientId &&
            actionData.clientSecret ? (
              <ClientSecret clientId={actionData.clientId} secret={actionData.clientSecret} />
            ) : null}
            {actionData?.ok && actionData.intent === "update" ? (
              <Alert tone="success" title={t("developerApps.detail.saved")} />
            ) : null}
            {actionData && !actionData.ok ? (
              <Alert tone="danger" title={t("developerApps.errors.title")}>
                {actionData.error}
              </Alert>
            ) : null}

            <div className="developer-client-layout grid items-start gap-12">
              <Form method="post" className="min-w-0">
                <input type="hidden" name="intent" value="update" />
                <DeveloperClientForm client={client} variant="create" />
                <Text size="sm" tone="muted" className="mt-8">
                  {t("developerApps.detail.effectNote")}
                </Text>
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-6">
                  <Button type="submit" loading={isUpdating}>
                    {t("developerApps.detail.save")}
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to="/developers/apps">{t("developerApps.create.cancel")}</Link>
                  </Button>
                </div>
              </Form>

              <aside className="min-w-0 space-y-11 lg:sticky lg:top-20">
                <section aria-labelledby="client-information-heading">
                  <Heading level={2} id="client-information-heading">
                    {t("developerApps.detail.additionalInformation")}
                  </Heading>
                  <dl className="mt-5 divide-y border-y text-sm">
                    <div className="developer-client-metadata grid gap-1 py-3">
                      <dt className="font-medium">{t("developerApps.fields.clientId")}</dt>
                      <dd className="break-all font-mono text-xs text-muted">{client.clientId}</dd>
                    </div>
                    <div className="developer-client-metadata grid gap-1 py-3">
                      <dt className="font-medium">{t("developerApps.detail.createdAt")}</dt>
                      <dd className="text-muted">{formatDate(client.createdAt)}</dd>
                    </div>
                    <div className="developer-client-metadata grid gap-1 py-3">
                      <dt className="font-medium">{t("developerApps.detail.updatedAt")}</dt>
                      <dd className="text-muted">{formatDate(client.updatedAt)}</dd>
                    </div>
                  </dl>
                </section>

                <section aria-labelledby="client-secrets-heading">
                  <Heading level={2} id="client-secrets-heading">
                    {t("developerApps.detail.clientSecrets")}
                  </Heading>
                  <Text size="sm" tone="muted">
                    {t("developerApps.detail.credentialsDescription")}
                  </Text>
                  <Alert tone="info" title={t("developerApps.secret.notShown")} className="mt-4" />
                  <div className="mt-5">
                    <ConfirmAction
                      intent="rotate"
                      icon={<Icons name="Key" size={16} aria-hidden="true" />}
                      trigger={t("developerApps.detail.rotate")}
                      title={t("developerApps.dialog.rotateTitle")}
                      description={t("developerApps.dialog.rotateDescription")}
                      confirm={t("developerApps.dialog.rotateConfirm")}
                    />
                  </div>
                </section>

                <section aria-labelledby="client-status-heading">
                  <div className="flex items-center justify-between gap-3">
                    <Heading level={2} id="client-status-heading">
                      {t("developerApps.detail.status")}
                    </Heading>
                    <Badge tone={client.disabled ? "neutral" : "success"}>
                      {client.disabled
                        ? t("developerApps.status.disabled")
                        : t("developerApps.status.active")}
                    </Badge>
                  </div>
                  <Text size="sm" tone="muted" className="mt-4">
                    {client.disabled
                      ? t("developerApps.detail.enableDescription")
                      : t("developerApps.detail.disableDescription")}
                  </Text>
                  <div className="mt-5">
                    {client.disabled ? (
                      <ConfirmAction
                        intent="enable"
                        icon={<Icons name="PlugZap" size={16} aria-hidden="true" />}
                        trigger={t("developerApps.detail.enable")}
                        title={t("developerApps.dialog.enableTitle")}
                        description={t("developerApps.dialog.enableDescription")}
                        confirm={t("developerApps.dialog.enableConfirm")}
                      />
                    ) : (
                      <ConfirmAction
                        intent="disable"
                        icon={<Icons name="Ban" size={16} aria-hidden="true" />}
                        trigger={t("developerApps.detail.disable")}
                        title={t("developerApps.dialog.disableTitle")}
                        description={t("developerApps.dialog.disableDescription")}
                        confirm={t("developerApps.dialog.disableConfirm")}
                      />
                    )}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
