import { ArrowLeft, KeyRound, Power, PowerOff, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import {
  ClientSecret,
  DeveloperAccessRequired,
  DeveloperClientForm,
  type DeveloperClientView,
  SecretRow,
} from "~/components/developer-apps";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
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
  const [t, access] = await Promise.all([
    i18n.getFixedT(args.request),
    loadDeveloperAccess(env, args.request),
  ]);
  const client = access.eligible
    ? await getDeveloperClient(env, args.request, args.params.clientId)
    : null;
  if (access.eligible && !client) throw new Response("Not Found", { status: 404 });
  return { ...access, client, title: t("meta.developerAppsDetail") };
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
}: {
  intent: string;
  icon: React.ReactNode;
  trigger: string;
  title: string;
  description: string;
  confirm: string;
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={destructive ? "destructive" : "outline"} size="sm">
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
  return (
    <PageShell user={loaderData.user} size="lg">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/developers/apps" prefetch="intent">
          <ArrowLeft className="size-4" /> {t("developerApps.back")}
        </Link>
      </Button>
      {!loaderData.eligible || !client ? (
        <DeveloperAccessRequired user={loaderData.user} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-medium tracking-tight">{client.name}</h1>
                <Badge variant={client.disabled ? "secondary" : "default"}>
                  {client.disabled
                    ? t("developerApps.status.disabled")
                    : t("developerApps.status.active")}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("developerApps.detail.subtitle")}
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-6">
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
            <Card>
              <CardHeader>
                <CardTitle>{t("developerApps.detail.credentials")}</CardTitle>
                <CardDescription>
                  {t("developerApps.detail.credentialsDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <SecretRow label={t("developerApps.fields.clientId")} value={client.clientId} />
                <p className="text-xs text-muted-foreground">
                  {t("developerApps.secret.notShown")}
                </p>
                <ConfirmAction
                  intent="rotate"
                  icon={<KeyRound className="size-4" />}
                  trigger={t("developerApps.detail.rotate")}
                  title={t("developerApps.dialog.rotateTitle")}
                  description={t("developerApps.dialog.rotateDescription")}
                  confirm={t("developerApps.dialog.rotateConfirm")}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("developerApps.detail.settings")}</CardTitle>
                <CardDescription>{t("developerApps.detail.settingsDescription")}</CardDescription>
              </CardHeader>
              <Form method="post">
                <input type="hidden" name="intent" value="update" />
                <CardContent>
                  <DeveloperClientForm client={client} />
                </CardContent>
                <CardFooter className="justify-end border-t pt-6">
                  <SubmitButton
                    pending={isUpdating}
                    pendingLabel={t("developerApps.detail.saving")}
                  >
                    {t("developerApps.detail.save")}
                  </SubmitButton>
                </CardFooter>
              </Form>
            </Card>
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle>{t("developerApps.detail.dangerZone")}</CardTitle>
                <CardDescription>{t("developerApps.detail.dangerDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
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
                <ConfirmAction
                  intent="delete"
                  icon={<Trash2 className="size-4" />}
                  trigger={t("developerApps.detail.delete")}
                  title={t("developerApps.dialog.deleteTitle")}
                  description={t("developerApps.dialog.deleteDescription")}
                  confirm={t("developerApps.dialog.deleteConfirm")}
                  destructive
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}
