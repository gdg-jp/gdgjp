import type { AuthUser } from "@gdgjp/gdg-lib";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PageShell } from "~/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { authClient } from "~/lib/auth-client";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { getAuth } from "~/lib/auth.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { Route } from "./+types/settings";

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const t = await i18n.getFixedT(args.request);
  let user: AuthUser;
  try {
    user = await getAuth(env).requireUser(args.request);
  } catch (err) {
    if (err instanceof Response && err.status === 401) {
      throw buildSignInRedirect(args.request);
    }
    throw err;
  }
  return { user, title: t("meta.settings") };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    setError(null);
    const res = await authClient.deleteUser({});
    if (res.error) {
      setError(res.error.message ?? t("settings.danger.errorGeneric"));
      setPending(false);
      return;
    }
    window.location.href = "/auth/signout";
  }

  return (
    <PageShell user={loaderData.user}>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link to="/dashboard">
          <ArrowLeft className="size-4" /> {t("nav.backToDashboard")}
        </Link>
      </Button>

      <h1 className="text-3xl font-medium tracking-tight">{t("settings.title")}</h1>

      <Card className="mt-6 border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">{t("settings.danger.title")}</CardTitle>
          <CardDescription>{t("settings.danger.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.danger.errorTitle")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={pending}>
                <Trash2 className="size-4" />
                {t("settings.danger.deleteCta")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("settings.danger.dialogTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("settings.danger.dialogDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>
                  {t("settings.danger.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive"
                  disabled={pending}
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete();
                  }}
                >
                  {t("settings.danger.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </PageShell>
  );
}
