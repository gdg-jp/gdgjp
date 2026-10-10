import { Badge, Button, Card, Heading, Icons, Inline, Stack, Text } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { Link, useNavigation, useSearchParams } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { safeReturnTo } from "~/features/auth/auth-redirect";
import { GoogleGlyph } from "~/features/auth/components/google-glyph";
import { loadSignin } from "~/features/auth/signin.server";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/signin";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadSignin(args);
}

type PageProps = { loaderData: RouteData<typeof loadSignin> };

export default function SignInPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const returnTo = safeReturnTo(params.get("return_to")) ?? "/dashboard";
  const oauthQuery = params.has("client_id") ? params.toString() : "";

  return (
    <div className="min-h-dvh bg-background">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <Card className="w-full max-w-md">
          <Stack className="text-center">
            <Link to="/" aria-label={t("nav.homeAria")}>
              <GdgMark size="md" />
            </Link>
            <Badge tone="info">{t("app.name")}</Badge>
            <Stack className="gap-2">
              <Heading level={1}>{t("auth.signin.title")}</Heading>
              <Text tone="muted">{t("auth.signin.subtitle")}</Text>
            </Stack>
            <Text tone="muted" className="text-center">
              {returnTo.startsWith("/invite/")
                ? t("auth.signin.inviteHint")
                : t("auth.signin.welcome")}
            </Text>
            <form method="get" action="/oauth/google/start" className="space-y-3">
              <input type="hidden" name="return_to" value={returnTo} />
              {oauthQuery ? <input type="hidden" name="oauth_query" value={oauthQuery} /> : null}
              <Button
                type="submit"
                fullWidth
                size="lg"
                variant="outline"
                loading={navigation.state !== "idle"}
              >
                <GoogleGlyph />
                {t("auth.signin.continueWithGoogle")}
              </Button>
            </form>
            <div className="flex items-start gap-2 rounded-md bg-neutral p-3">
              <Icons name="ShieldCheck" size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <Text size="sm" tone="muted">
                {t("auth.signin.secure")}
              </Text>
            </div>
            <Inline className="justify-center text-center">
              <Icons name="Check" size={14} aria-hidden="true" />
              <Text size="sm" tone="muted">
                {t("app.name")}
              </Text>
            </Inline>
          </Stack>
        </Card>
      </main>
    </div>
  );
}
