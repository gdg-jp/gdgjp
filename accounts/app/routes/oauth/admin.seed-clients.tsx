import { Alert, Button, Card, Icons, Stack, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { useActionData, useNavigation } from "react-router";
import { PageHeader } from "~/components/page-header";
import {
  actOnAdminSeedClients,
  loadAdminSeedClients,
} from "~/features/oauth/admin-seed-clients.server";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/admin.seed-clients";

export function loader(args: Route.LoaderArgs) {
  return loadAdminSeedClients(args);
}

export function action(args: Route.ActionArgs) {
  return actOnAdminSeedClients(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadAdminSeedClients>;
  actionData?: RouteData<typeof actOnAdminSeedClients>;
};

export default function SeedClientsPage({ loaderData }: PageProps) {
  const { t } = useTranslation();
  const actionData = useActionData<typeof actOnAdminSeedClients>();
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
