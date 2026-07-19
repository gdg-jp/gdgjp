import { Info, KeyRound, Power, PowerOff, Trash2 } from "lucide-react";
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
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SubmitButton } from "~/components/ui/submit-button";
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
          variant={toolbar ? "ghost" : destructive ? "destructive" : "outline"}
          size="sm"
          className={toolbar ? "text-destructive hover:text-destructive" : undefined}
        >
          {icon} {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("developerApps.dialog.cancel")}</AlertDialogCancel>
          <Form method="post">
            <input type="hidden" name="intent" value={intent} />
            <SubmitButton variant={destructive ? "destructive" : "default"} pending={pending}>
              {confirm}
            </SubmitButton>
          </Form>
        </AlertDialogFooter>
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
              icon={<Trash2 className="size-4" />}
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
              <Alert>
                <AlertTitle>{t("developerApps.detail.saved")}</AlertTitle>
              </Alert>
            ) : null}
            {actionData && !actionData.ok ? (
              <Alert variant="destructive">
                <AlertTitle>{t("developerApps.errors.title")}</AlertTitle>
                <AlertDescription>{actionData.error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.85fr)]">
              <Form method="post" className="min-w-0">
                <input type="hidden" name="intent" value="update" />
                <DeveloperClientForm client={client} variant="create" />
                <p className="mt-8 text-sm text-muted-foreground">
                  {t("developerApps.detail.effectNote")}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-6">
                  <SubmitButton
                    pending={isUpdating}
                    pendingLabel={t("developerApps.detail.saving")}
                  >
                    {t("developerApps.detail.save")}
                  </SubmitButton>
                  <Button asChild variant="ghost">
                    <Link to="/developers/apps">{t("developerApps.create.cancel")}</Link>
                  </Button>
                </div>
              </Form>

              <aside className="min-w-0 space-y-11 lg:sticky lg:top-20">
                <section aria-labelledby="client-information-heading">
                  <h2
                    id="client-information-heading"
                    className="text-xl font-medium tracking-tight"
                  >
                    {t("developerApps.detail.additionalInformation")}
                  </h2>
                  <dl className="mt-5 divide-y border-y text-sm">
                    <div className="grid gap-1 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                      <dt className="font-medium">{t("developerApps.fields.clientId")}</dt>
                      <dd className="break-all font-mono text-xs text-muted-foreground">
                        {client.clientId}
                      </dd>
                    </div>
                    <div className="grid gap-1 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                      <dt className="font-medium">{t("developerApps.detail.createdAt")}</dt>
                      <dd className="text-muted-foreground">{formatDate(client.createdAt)}</dd>
                    </div>
                    <div className="grid gap-1 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                      <dt className="font-medium">{t("developerApps.detail.updatedAt")}</dt>
                      <dd className="text-muted-foreground">{formatDate(client.updatedAt)}</dd>
                    </div>
                  </dl>
                </section>

                <section aria-labelledby="client-secrets-heading">
                  <h2 id="client-secrets-heading" className="text-xl font-medium tracking-tight">
                    {t("developerApps.detail.clientSecrets")}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t("developerApps.detail.credentialsDescription")}
                  </p>
                  <div className="mt-4 flex gap-3 rounded-md bg-muted/70 px-4 py-3 text-sm">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <p className="leading-relaxed">{t("developerApps.secret.notShown")}</p>
                  </div>
                  <div className="mt-5">
                    <ConfirmAction
                      intent="rotate"
                      icon={<KeyRound className="size-4" />}
                      trigger={t("developerApps.detail.rotate")}
                      title={t("developerApps.dialog.rotateTitle")}
                      description={t("developerApps.dialog.rotateDescription")}
                      confirm={t("developerApps.dialog.rotateConfirm")}
                    />
                  </div>
                </section>

                <section aria-labelledby="client-status-heading">
                  <div className="flex items-center justify-between gap-3">
                    <h2 id="client-status-heading" className="text-xl font-medium tracking-tight">
                      {t("developerApps.detail.status")}
                    </h2>
                    <Badge variant={client.disabled ? "secondary" : "default"}>
                      {client.disabled
                        ? t("developerApps.status.disabled")
                        : t("developerApps.status.active")}
                    </Badge>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {client.disabled
                      ? t("developerApps.detail.enableDescription")
                      : t("developerApps.detail.disableDescription")}
                  </p>
                  <div className="mt-5">
                    {client.disabled ? (
                      <ConfirmAction
                        intent="enable"
                        icon={<Power className="size-4" />}
                        trigger={t("developerApps.detail.enable")}
                        title={t("developerApps.dialog.enableTitle")}
                        description={t("developerApps.dialog.enableDescription")}
                        confirm={t("developerApps.dialog.enableConfirm")}
                      />
                    ) : (
                      <ConfirmAction
                        intent="disable"
                        icon={<PowerOff className="size-4" />}
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
