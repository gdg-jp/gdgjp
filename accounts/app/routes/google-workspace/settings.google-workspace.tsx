import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  Heading,
  Icons,
  Stack,
  Text,
  toast,
} from "@gdgjp/design-system";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { PageHeader } from "~/components/page-header";
import {
  actOnSettingsGoogleWorkspace,
  loadSettingsGoogleWorkspace,
} from "~/features/google-workspace/settings-google-workspace.server";
import { PageShell } from "~/layouts/page-shell";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/settings.google-workspace";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadSettingsGoogleWorkspace(args);
}

export function action(args: Route.ActionArgs) {
  return actOnSettingsGoogleWorkspace(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadSettingsGoogleWorkspace>;
  actionData?: RouteData<typeof actOnSettingsGoogleWorkspace>;
};

export default function GoogleWorkspaceSettings({ loaderData }: PageProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof actOnSettingsGoogleWorkspace>();
  const { connected, scope, workspaceStatus, workspaceReason } = loaderData;
  const isDisconnecting = fetcher.state !== "idle";

  useEffect(() => {
    if (workspaceStatus === "connected") {
      toast.success(t("settings.googleWorkspace.toastConnected"));
    } else if (workspaceStatus === "error") {
      toast.error(
        t("settings.googleWorkspace.toastError", { reason: workspaceReason ?? "unknown" }),
      );
    }
  }, [workspaceStatus, workspaceReason, t]);

  return (
    <PageShell size="md">
      <PageHeader
        title={t("settings.googleWorkspace.title")}
        description={t("settings.googleWorkspace.description")}
      />
      {workspaceStatus === "error" ? (
        <Alert
          tone="danger"
          title={t("settings.googleWorkspace.toastError", { reason: workspaceReason ?? "unknown" })}
        />
      ) : null}
      <Card className="mt-6">
        <Stack>
          <div className="flex items-center gap-2">
            {connected ? (
              <Icons name="CircleCheck" size={16} aria-hidden="true" />
            ) : (
              <Icons name="PlugZap" size={16} aria-hidden="true" />
            )}
            <Heading level={2} className="text-base">
              {connected
                ? t("settings.googleWorkspace.connectedTitle")
                : t("settings.googleWorkspace.notConnectedTitle")}
            </Heading>
          </div>
          <Text tone="muted">
            {connected
              ? t("settings.googleWorkspace.connectedDescription", { scope })
              : t("settings.googleWorkspace.notConnectedDescription")}
          </Text>
        </Stack>
        <div className="mt-6 flex flex-wrap gap-2">
          {connected ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Icons name="PlugZap" size={16} aria-hidden="true" />
                  {t("settings.googleWorkspace.disconnect")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <Stack className="gap-2">
                  <AlertDialogTitle>
                    {t("settings.googleWorkspace.disconnectConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("settings.googleWorkspace.disconnectConfirmDescription")}
                  </AlertDialogDescription>
                </Stack>
                <div className="flex flex-wrap justify-end gap-3">
                  <AlertDialogCancel asChild>
                    <Button type="button" variant="outline">
                      {t("chapters.leaveDialog.cancel")}
                    </Button>
                  </AlertDialogCancel>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="disconnect" />
                    <AlertDialogAction asChild>
                      <Button type="submit" variant="danger" loading={isDisconnecting}>
                        {t("settings.googleWorkspace.disconnect")}
                      </Button>
                    </AlertDialogAction>
                  </fetcher.Form>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button asChild size="sm">
              <a href="/oauth/google-workspace/start?return_to=%2Fsettings%2Fgoogle-workspace">
                {t("settings.googleWorkspace.connect")}
              </a>
            </Button>
          )}
        </div>
      </Card>
    </PageShell>
  );
}
