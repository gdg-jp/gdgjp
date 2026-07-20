import { Check, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "~/components/ui/card";
import { SubmitButton } from "~/components/ui/submit-button";
import { safeReturnTo } from "~/lib/auth-redirect";
import { getSessionUser } from "~/lib/auth.server";
import { i18n } from "~/lib/i18n/i18n.server";
import type { Route } from "./+types/signin";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const t = await i18n.getFixedT(request);
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/dashboard";
  // If already signed in, jump straight to return_to.
  const session = await getSessionUser(env, request);
  if (session) throw redirect(returnTo);
  return { title: t("meta.signin"), returnTo };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

function GoogleGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <title>Google</title>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.6Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.92v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7a5.41 5.41 0 0 1 0-3.4V4.96H.92a9 9 0 0 0 0 8.08l3.03-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58A9 9 0 0 0 .92 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function SignInPage() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("return_to")) ?? "/dashboard";
  const oauthQuery = params.has("client_id") ? params.toString() : "";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-muted/40">
      <div className="pointer-events-none absolute -top-32 -right-32 size-[420px] rounded-full bg-gdg-blue/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 size-[420px] rounded-full bg-gdg-yellow/10 blur-3xl" />

      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="relative grid min-h-dvh place-items-center px-4 py-10">
        <Card className="w-full max-w-md shadow-sm">
          <CardHeader className="justify-items-center space-y-3 text-center">
            <Link to="/" aria-label={t("nav.homeAria")}>
              <GdgMark size="md" />
            </Link>
            <Badge variant="outline">{t("app.name")}</Badge>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-medium tracking-tight">{t("auth.signin.title")}</h1>
              <CardDescription>{t("auth.signin.subtitle")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-center text-sm text-muted-foreground">{t("auth.signin.welcome")}</p>
            <Form method="get" action="/oauth/google/start" className="space-y-3">
              <input type="hidden" name="return_to" value={returnTo} />
              {oauthQuery ? <input type="hidden" name="oauth_query" value={oauthQuery} /> : null}
              <SubmitButton
                type="submit"
                className="w-full"
                size="lg"
                variant="outline"
                pending={navigation.state !== "idle"}
                pendingLabel={t("auth.signin.continueWithGooglePending")}
              >
                <GoogleGlyph />
                {t("auth.signin.continueWithGoogle")}
              </SubmitButton>
            </Form>
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gdg-blue" aria-hidden="true" />
              <span>{t("auth.signin.secure")}</span>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Check className="size-3.5 text-gdg-green" aria-hidden="true" />
              {t("app.name")}
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
