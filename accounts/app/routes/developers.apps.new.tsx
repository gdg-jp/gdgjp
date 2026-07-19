import { CheckCircle2, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, useNavigation } from "react-router";
import {
  ClientSecret,
  DeveloperAccessRequired,
  DeveloperClientForm,
} from "~/components/developer-apps";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
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
import { createDeveloperClient } from "~/lib/oauth-clients.server";
import type { Route } from "./+types/developers.apps.new";

export async function loader(args: Route.LoaderArgs) {
  const [t, access] = await Promise.all([
    i18n.getFixedT(args.request),
    loadDeveloperAccess(args.context.cloudflare.env, args.request),
  ]);
  return { ...access, title: t("meta.developerAppsNew") };
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
  try {
    const result = await createDeveloperClient(
      env,
      args.request,
      parseDeveloperClientForm(await args.request.formData()),
    );
    return data(
      {
        ok: true as const,
        clientId: result.client.clientId,
        clientSecret: result.clientSecret,
      },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (error) {
    if (error instanceof Response && error.status === 403) throw error;
    return { ok: false as const, error: t("developerApps.errors.create") };
  }
}

export default function NewDeveloperApp({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  return (
    <PageShell user={loaderData.user} size="lg">
      <PageHeader
        back={{ to: "/developers/apps", label: t("developerApps.back") }}
        eyebrow={t("developerApps.list.title")}
        title={t("developerApps.create.title")}
        description={t("developerApps.create.subtitle")}
      />
      <div className="mt-8">
        {!loaderData.eligible ? (
          <DeveloperAccessRequired user={loaderData.user} />
        ) : actionData?.ok ? (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 />
              <AlertTitle>{t("developerApps.create.submit")}</AlertTitle>
              <AlertDescription>{t("developerApps.secret.description")}</AlertDescription>
            </Alert>
            <ClientSecret clientId={actionData.clientId} secret={actionData.clientSecret} />
            <Button asChild>
              <Link to={`/developers/apps/${encodeURIComponent(actionData.clientId)}`}>
                {t("developerApps.create.manage")}
              </Link>
            </Button>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="text-xl">{t("developerApps.create.cardTitle")}</CardTitle>
              <CardDescription className="max-w-3xl">
                {t("developerApps.create.cardDescription")}
              </CardDescription>
            </CardHeader>
            <Form method="post">
              <CardContent className="space-y-6 p-6 md:p-8">
                <Alert>
                  <Info />
                  <AlertTitle>{t("developerApps.create.beforeYouStart")}</AlertTitle>
                  <AlertDescription>
                    {t("developerApps.create.beforeYouStartDescription")}
                  </AlertDescription>
                </Alert>
                {actionData && !actionData.ok ? (
                  <Alert variant="destructive">
                    <AlertTitle>{t("developerApps.errors.title")}</AlertTitle>
                    <AlertDescription>{actionData.error}</AlertDescription>
                  </Alert>
                ) : null}
                <DeveloperClientForm />
              </CardContent>
              <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted/20 px-6 py-4 sm:flex-row sm:items-center sm:justify-end md:px-8">
                <Button asChild variant="ghost">
                  <Link to="/developers/apps">{t("developerApps.create.cancel")}</Link>
                </Button>
                <SubmitButton pending={pending} pendingLabel={t("developerApps.create.pending")}>
                  {t("developerApps.create.submit")}
                </SubmitButton>
              </CardFooter>
            </Form>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
