// One-shot admin route to (re-)seed the trusted OAuth clients into D1.
// Idempotent — safe to re-run after rotating a client secret.

import { Alert, Button, Card, Icons, Stack, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { redirect, useActionData, useNavigation } from "react-router";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
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
      <PageHeader title={t("adminSeed.title")} />
      <Card className="mt-6">
        <Stack>
          <Alert tone="info" title={t("adminSeed.noticeTitle")}>
            {t("adminSeed.noticeDescription")}
          </Alert>
          <form method="post">
            <Button type="submit" loading={submitting}>
              <Icons name="Database" size={16} aria-hidden="true" />
              {t("adminSeed.submit")}
            </Button>
          </form>
        </Stack>
      </Card>
      {actionData ? (
        <Alert tone="success" title={t("adminSeed.result", { at: actionData.at })} className="mt-6">
          <Stack className="gap-1">
            <Text size="sm">
              {t("adminSeed.written", { value: actionData.written.join(", ") || "—" })}
            </Text>
            <Text size="sm">
              {t("adminSeed.skipped", { value: actionData.skipped.join(", ") || "—" })}
            </Text>
          </Stack>
        </Alert>
      ) : null}
    </PageShell>
  );
}
