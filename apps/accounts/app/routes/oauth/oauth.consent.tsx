import { Badge, Button, Card, Heading, Icons, Stack, Text } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { actOnOauthConsent, loadOauthConsent } from "~/features/oauth/oauth-consent.server";
import type { RouteData } from "~/lib/route-data";
import type { Route } from "./+types/oauth.consent";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

export function loader(args: Route.LoaderArgs) {
  return loadOauthConsent(args);
}

export function action(args: Route.ActionArgs) {
  return actOnOauthConsent(args);
}

type PageProps = {
  loaderData: RouteData<typeof loadOauthConsent>;
  actionData?: RouteData<typeof actOnOauthConsent>;
};

const KNOWN_SCOPES = new Set([
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://gdgs.jp/scopes/chapters",
]);

export default function ConsentPage({ loaderData }: PageProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const scopes = scopesForDisplay(params.get("scope"));
  const isSubmitting = navigation.state !== "idle";
  const appName = loaderData.client?.name || t("auth.consent.unknownApp");

  return (
    <div className="min-h-dvh bg-background">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <Card className="w-full max-w-lg">
          <Stack align="start" className="gap-4 sm:flex-row">
            <Link to="/" aria-label={t("nav.homeAria")} className="shrink-0">
              <GdgMark size="md" />
            </Link>
            <Stack className="min-w-0 gap-2">
              <Badge tone="info">{t("auth.consent.eyebrow")}</Badge>
              <Heading level={1}>{t("auth.consent.title", { appName })}</Heading>
              <Text tone="muted">{t("auth.consent.description")}</Text>
            </Stack>
          </Stack>
          <Stack className="mt-6">
            {loaderData.client?.appUrl ? (
              <a
                href={loaderData.client.appUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3 text-sm hover:bg-neutral"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icons name="Earth" size={16} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-xs text-muted">{t("auth.consent.website")}</span>
                    <span className="block truncate font-medium">{loaderData.client.appUrl}</span>
                  </span>
                </span>
                <Icons name="ArrowUpRight" size={16} className="shrink-0" aria-hidden="true" />
              </a>
            ) : null}

            <section aria-labelledby="requested-permissions">
              <div className="flex items-center gap-2">
                <Icons name="ShieldCheck" size={16} aria-hidden="true" />
                <Heading level={2} id="requested-permissions" className="text-base">
                  {t("auth.consent.permissions")}
                </Heading>
              </div>
              <ul className="mt-3 space-y-2">
                {scopes.length === 0 ? (
                  <li className="rounded-md border border-border bg-background p-3 text-sm">
                    {t("auth.consent.noPermissions")}
                  </li>
                ) : (
                  scopes.map((scope) => (
                    <li
                      key={scope}
                      className="flex items-start gap-3 rounded-md border border-border bg-surface p-3 text-sm"
                    >
                      <Icons
                        name="Check"
                        size={16}
                        className="mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{t(scopeLabelKey(scope))}</span>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <Form method="post" action="/oauth/consent" className="space-y-4">
              <input type="hidden" name="oauth_query" value={params.toString()} />
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="submit"
                  name="accept"
                  value="false"
                  variant="outline"
                  disabled={isSubmitting}
                  loading={isSubmitting && navigation.formData?.get("accept") === "false"}
                >
                  <Icons name="X" size={16} aria-hidden="true" />
                  {t("auth.consent.deny")}
                </Button>
                <Button
                  type="submit"
                  name="accept"
                  value="true"
                  disabled={isSubmitting}
                  loading={isSubmitting && navigation.formData?.get("accept") === "true"}
                >
                  <Icons name="Check" size={16} aria-hidden="true" />
                  {t("auth.consent.allow")}
                </Button>
              </div>
            </Form>
            <Text size="xs" tone="muted">
              {t("auth.consent.privacy")}
            </Text>
          </Stack>
        </Card>
      </main>
    </div>
  );
}

function scopesForDisplay(scope: string | null): string[] {
  if (!scope) return [];
  const requested = new Set(scope.split(/\s+/).filter(Boolean));
  const known = [...requested].filter((item) => KNOWN_SCOPES.has(item));
  return requested.size > known.length ? [...known, "unknown"] : known;
}

function scopeLabelKey(scope: string): string {
  if (scope === "https://gdgs.jp/scopes/chapters") return "auth.consent.scope.chapters";
  if (scope === "unknown") return "auth.consent.scope.unknown";
  return `auth.consent.scope.${scope}`;
}
