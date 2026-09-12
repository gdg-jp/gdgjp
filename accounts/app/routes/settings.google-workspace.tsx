import {
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
} from "@gdgjp/ui";
import { toast } from "@gdgjp/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { PageHeader } from "~/components/page-header";
import { PageShell } from "~/components/page-shell";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser } from "~/lib/auth.server";
import {
  decryptRefreshToken,
  getWorkspaceConnection,
  revokeGoogleToken,
  revokeWorkspaceConnection,
} from "~/lib/google-workspace.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { Route } from "./+types/settings.google-workspace";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const [t, user] = await Promise.all([
    i18n.getFixedT(args.request),
    requireUser(env, args.request).catch((err: unknown) => {
      if (err instanceof Response && err.status === 401) throw buildSignInRedirect(args.request);
      throw err;
    }),
  ]);
  const connection = await getWorkspaceConnection(env.DB, user.id);
  const url = new URL(args.request.url);
  return {
    title: t("meta.googleWorkspace"),
    connected: connection !== null && connection.revokedAt === null,
    scope: connection?.revokedAt === null ? connection.scope : null,
    connectedAt: connection?.revokedAt === null ? connection.connectedAt : null,
    workspaceStatus: url.searchParams.get("workspace"),
    workspaceReason: url.searchParams.get("workspace_reason"),
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const user = await requireUser(env, args.request).catch((err: unknown) => {
    if (err instanceof Response && err.status === 401) throw buildSignInRedirect(args.request);
    throw err;
  });
  const form = await args.request.formData();
  if (String(form.get("intent") ?? "") !== "disconnect") {
    return { ok: false as const };
  }

  const connection = await getWorkspaceConnection(env.DB, user.id);
  if (connection && connection.revokedAt === null) {
    // Local disconnect must succeed even if the token can't be decrypted
    // (stale/missing key, corrupted row) or Google's revoke call fails —
    // otherwise the user would be unable to disconnect, and vending would
    // resume if the key later became available again.
    try {
      const refreshToken = await decryptRefreshToken(
        env,
        user.id,
        connection.encryptionKeyVersion,
        connection.refreshTokenCiphertext,
        connection.refreshTokenNonce,
      );
      await revokeGoogleToken(env, refreshToken);
    } catch (error) {
      console.error("Google Workspace disconnect: failed to revoke the token with Google", error);
    } finally {
      await revokeWorkspaceConnection(env.DB, user.id);
    }
  }
  return { ok: true as const };
}

export default function GoogleWorkspaceSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof action>();
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
      <Card>
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
