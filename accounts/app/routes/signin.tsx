import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useSearchParams } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { SubmitButton } from "~/components/ui/submit-button";
import { safeReturnTo } from "~/lib/auth-redirect";
import { i18n } from "~/lib/i18n/i18n.server";
import { readIdpSession } from "~/lib/idp-session.server";
import type { Route } from "./+types/signin";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const t = await i18n.getFixedT(request);
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/dashboard";
  // If already signed in, jump straight to return_to.
  const session = await readIdpSession(request, env.IDP_SESSION_SECRET);
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
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("return_to")) ?? "/dashboard";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-muted/40">
      <div className="pointer-events-none absolute -top-32 -right-32 size-[420px] rounded-full bg-gdg-blue/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 size-[420px] rounded-full bg-gdg-yellow/10 blur-3xl" />

      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="relative grid min-h-dvh place-items-center px-4 py-10">
        <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border bg-card p-8 shadow-sm">
          <Link to="/" aria-label={t("nav.homeAria")}>
            <GdgMark size="md" />
          </Link>
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-medium tracking-tight">{t("auth.signin.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("auth.signin.subtitle")}</p>
          </div>
          <Form method="get" action="/oauth/google/start" className="w-full">
            <input type="hidden" name="return_to" value={returnTo} />
            <SubmitButton type="submit" className="w-full" size="lg" variant="outline">
              <GoogleGlyph />
              {t("auth.signin.continueWithGoogle")}
            </SubmitButton>
          </Form>
          <p className="text-center text-xs text-muted-foreground">{t("app.name")}</p>
        </div>
      </main>
    </div>
  );
}
