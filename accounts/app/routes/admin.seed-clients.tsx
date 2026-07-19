// One-shot admin route to (re-)seed the trusted OAuth clients into D1.
// Idempotent — safe to re-run after rotating a client secret.

import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { redirect, useActionData, useNavigation } from "react-router";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Card, CardContent } from "~/components/ui/card";
import { SubmitButton } from "~/components/ui/submit-button";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import { seedClients } from "~/lib/seed-clients.server";
import type { Route } from "./+types/admin.seed-clients";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(env, request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) throw buildSignInRedirect(request);
    throw err;
  }
  if (!user.isAdmin) throw new Response("Forbidden", { status: 403 });
  return { user };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(env, request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) throw buildSignInRedirect(request);
    throw err;
  }
  if (!user.isAdmin) throw new Response("Forbidden", { status: 403 });
  if (request.method !== "POST") throw redirect("/admin/seed-clients");
  const result = await seedClients(env);
  return { ...result, at: new Date().toISOString() };
}

export default function SeedClientsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state !== "idle";
  return (
    <PageShell user={loaderData.user} size="sm">
      <PageHeader
        eyebrow={t("nav.administration")}
        title={t("adminSeed.title")}
        description={t("adminSeed.description")}
      />
      <Card className="mt-6">
        <CardContent className="space-y-4">
          <Alert>
            <Database />
            <AlertTitle>{t("adminSeed.noticeTitle")}</AlertTitle>
            <AlertDescription>{t("adminSeed.noticeDescription")}</AlertDescription>
          </Alert>
          <form method="post">
            <SubmitButton pending={submitting} pendingLabel={t("adminSeed.pending")}>
              {t("adminSeed.submit")}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
      {actionData ? (
        <Alert className="mt-6">
          <AlertTitle>{t("adminSeed.result", { at: actionData.at })}</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>{t("adminSeed.written", { value: actionData.written.join(", ") || "—" })}</p>
            <p>{t("adminSeed.skipped", { value: actionData.skipped.join(", ") || "—" })}</p>
          </AlertDescription>
        </Alert>
      ) : null}
    </PageShell>
  );
}
