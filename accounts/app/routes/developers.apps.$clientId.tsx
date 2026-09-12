import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Heading,
  Icons,
  Stack,
  Text,
} from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import {
  ClientSecret,
  DeveloperAccessRequired,
  DeveloperClientForm,
  type DeveloperClientView,
} from "~/components/developer-apps";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { loadDeveloperAccess } from "~/lib/developer-access.server";
import { parseDeveloperClientForm } from "~/lib/developer-app-form.server";
import { i18n } from "~/lib/i18n/i18n.server";
import {
  deleteDeveloperClient,
  getDeveloperClient,
  rotateDeveloperClientSecret,
  setDeveloperClientEnabled,
  updateDeveloperClient,
} from "~/lib/oauth-clients.server";
import type { Route } from "./+types/developers.apps.$clientId";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const [t, locale, access] = await Promise.all([
    i18n.getFixedT(args.request),
    i18n.getLocale(args.request),
    loadDeveloperAccess(env, args.request),
  ]);
  const client = access.eligible
    ? await getDeveloperClient(env, args.request, args.params.clientId)
    : null;
  if (access.eligible && !client) throw new Response("Not Found", { status: 404 });
  return { ...access, client, locale, title: t("meta.developerAppsDetail") };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const [t, access] = await Promise.all([
    i18n.getFixedT(args.request),
    loadDeveloperAccess(env, args.request),
  ]);
  if (!access.eligible) throw new Response("Forbidden", { status: 403 });
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "update") {
      await updateDeveloperClient(
        env,
        args.request,
        args.params.clientId,
        parseDeveloperClientForm(form),
      );
      return { ok: true as const, intent: "update" as const };
    }
    if (intent === "rotate") {
      const result = await rotateDeveloperClientSecret(env, args.request, args.params.clientId);
      return data(
        {
          ok: true as const,
          intent: "rotate" as const,
          clientId: result.client.clientId,
          clientSecret: result.clientSecret,
        },
        { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
      );
    }
    if (intent === "disable" || intent === "enable") {
      await setDeveloperClientEnabled(env, args.request, args.params.clientId, intent === "enable");
      return { ok: true as const, intent: intent as "disable" | "enable" };
    }
    if (intent === "delete") {
      await deleteDeveloperClient(env, args.request, args.params.clientId);
      return redirect("/developers/apps");
    }
    return { ok: false as const, error: t("errors.unknownAction") };
  } catch (error) {
    if (error instanceof Response && (error.status === 403 || error.status === 404)) throw error;
    return { ok: false as const, error: t("developerApps.errors.update") };
  }
}

function ConfirmAction({
  intent,
  icon,
  trigger,
  title,
  description,
  confirm,
  destructive = false,
  toolbar = false,
}: {
  intent: string;
  icon: React.ReactNode;
  trigger: string;
  title: string;
  description: string;
  confirm: string;
  destructive?: boolean;
  toolbar?: boolean;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={toolbar ? "ghost" : destructive ? "danger" : "outline"}
          size="sm"
          className={toolbar ? "text-danger hover:text-danger" : undefined}
        >
          {icon} {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Stack className="gap-2">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </Stack>
        <div className="flex flex-wrap justify-end gap-3">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              {t("developerApps.dialog.cancel")}
            </Button>
          </AlertDialogCancel>
          <Form method="post">
            <input type="hidden" name="intent" value={intent} />
            <AlertDialogAction asChild>
              <Button type="submit" variant={destructive ? "danger" : "primary"} loading={pending}>
                {confirm}
              </Button>
            </AlertDialogAction>
          </Form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function DeveloperAppDetail({ loaderData, actionData }: Route.ComponentProps) {
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
