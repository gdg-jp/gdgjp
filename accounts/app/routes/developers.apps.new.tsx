import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, useNavigation } from "react-router";
import {
  ClientSecret,
  DeveloperAccessRequired,
  DeveloperClientForm,
} from "~/components/developer-apps";
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
    <PageShell user={loaderData.user}>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/developers/apps" prefetch="intent">
          <ArrowLeft className="size-4" /> {t("developerApps.back")}
        </Link>
      </Button>
      <h1 className="text-3xl font-medium tracking-tight">{t("developerApps.create.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("developerApps.create.subtitle")}</p>
      <div className="mt-6">
        {!loaderData.eligible ? (
          <DeveloperAccessRequired user={loaderData.user} />
        ) : actionData?.ok ? (
          <div className="space-y-4">
            <ClientSecret clientId={actionData.clientId} secret={actionData.clientSecret} />
            <Button asChild>
              <Link to={`/developers/apps/${encodeURIComponent(actionData.clientId)}`}>
                {t("developerApps.create.manage")}
              </Link>
            </Button>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t("developerApps.create.cardTitle")}</CardTitle>
              <CardDescription>{t("developerApps.create.cardDescription")}</CardDescription>
            </CardHeader>
            <Form method="post">
              <CardContent className="space-y-6">
                {actionData && !actionData.ok ? (
                  <Alert variant="destructive">
                    <AlertTitle>{t("developerApps.errors.title")}</AlertTitle>
                    <AlertDescription>{actionData.error}</AlertDescription>
                  </Alert>
                ) : null}
                <DeveloperClientForm />
              </CardContent>
              <CardFooter className="justify-end border-t pt-6">
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
