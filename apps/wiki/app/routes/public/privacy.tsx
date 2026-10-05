import { Heading, Inline, PageHeader, Stack, Text, Link as UiLink } from "@gdgjp/design-system";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "Privacy Policy — GDG Japan Wiki" }];

export default function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-neutral">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
        <article>
          <PageHeader
            title={t("privacy.title")}
            description={t("privacy.last_updated")}
            back={
              <UiLink asChild>
                <Link to="/">{t("privacy.back")}</Link>
              </UiLink>
            }
          />
          <Stack className="mt-8">
            <Heading level={2}>{t("privacy.s1_heading")}</Heading>
            <Text tone="muted">{t("privacy.s1_body")}</Text>

            <Heading level={2}>{t("privacy.s2_heading")}</Heading>
            <Text tone="muted">{t("privacy.s2_body")}</Text>

            <Heading level={2}>{t("privacy.s3_heading")}</Heading>
            <Text tone="muted">{t("privacy.s3_intro")}</Text>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
              <li>
                <strong>Google OAuth</strong> —{" "}
                <Trans
                  i18nKey="privacy.s3_google"
                  components={{
                    googlePolicy: (
                      <a
                        href="https://policies.google.com/privacy"
                        className="text-link hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {" "}
                      </a>
                    ),
                  }}
                />
              </li>
              <li>
                <strong>Cloudflare</strong> —{" "}
                <Trans
                  i18nKey="privacy.s3_cloudflare"
                  components={{
                    cloudflarePolicy: (
                      <a
                        href="https://www.cloudflare.com/privacypolicy/"
                        className="text-link hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {" "}
                      </a>
                    ),
                  }}
                />
              </li>
              <li>
                <strong>Google Gemini API</strong> — {t("privacy.s3_gemini")}
              </li>
            </ul>

            <Heading level={2}>{t("privacy.s4_heading")}</Heading>
            <Text tone="muted">{t("privacy.s4_body")}</Text>

            <Heading level={2}>{t("privacy.s5_heading")}</Heading>
            <Text tone="muted">{t("privacy.s5_body")}</Text>
          </Stack>
        </article>
      </main>

      <footer className="border-t px-4 py-4 sm:px-6">
        <Inline className="justify-center">
          <Text size="xs" tone="muted">
            © {new Date().getFullYear()} GDG Japan
          </Text>
          <UiLink asChild>
            <Link to="/terms">{t("privacy.footer_link")}</Link>
          </UiLink>
        </Inline>
      </footer>
    </div>
  );
}
