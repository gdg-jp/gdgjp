import { Heading, Inline, PageHeader, Stack, Text, Link as UiLink } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "Terms of Service — GDG Japan Wiki" }];

export default function TermsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-neutral">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
        <article>
          <PageHeader
            title={t("terms.title")}
            description={t("terms.last_updated")}
            back={
              <UiLink asChild>
                <Link to="/">{t("terms.back")}</Link>
              </UiLink>
            }
          />
          <Stack className="mt-8">
            <Heading level={2}>{t("terms.s1_heading")}</Heading>
            <Text tone="muted">{t("terms.s1_body")}</Text>

            <Heading level={2}>{t("terms.s2_heading")}</Heading>
            <Text tone="muted">{t("terms.s2_body")}</Text>

            <Heading level={2}>{t("terms.s3_heading")}</Heading>
            <Text tone="muted">{t("terms.s3_body")}</Text>

            <Heading level={2}>{t("terms.s4_heading")}</Heading>
            <Text tone="muted">{t("terms.s4_intro")}</Text>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
              <li>{t("terms.s4_item1")}</li>
              <li>{t("terms.s4_item2")}</li>
              <li>{t("terms.s4_item3")}</li>
              <li>{t("terms.s4_item4")}</li>
            </ul>

            <Heading level={2}>{t("terms.s5_heading")}</Heading>
            <Text tone="muted">{t("terms.s5_body")}</Text>

            <Heading level={2}>{t("terms.s6_heading")}</Heading>
            <Text tone="muted">{t("terms.s6_body")}</Text>
          </Stack>
        </article>
      </main>

      <footer className="border-t px-4 py-4 sm:px-6">
        <Inline className="justify-center">
          <Text size="xs" tone="muted">
            © {new Date().getFullYear()} GDG Japan
          </Text>
          <UiLink asChild>
            <Link to="/privacy">{t("terms.footer_link")}</Link>
          </UiLink>
        </Inline>
      </footer>
    </div>
  );
}
