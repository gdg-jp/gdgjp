import { Button, Card, Heading, Icons, Stack, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function HomeCta() {
  const { t } = useTranslation("common");

  return (
    <section className="mb-10">
      <Card className="p-6 md:p-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Stack className="gap-2">
            <div className="flex items-center gap-2">
              <Icons name="Sparkles" className="h-6 w-6 text-link" aria-hidden="true" />
              <Heading level={2}>{t("home.cta_heading")}</Heading>
            </div>
            <Text size="sm" tone="muted" className="max-w-lg md:text-base">
              {t("home.cta_subheading")}
            </Text>
          </Stack>
          <Button asChild className="shrink-0">
            <Link to="/ingest">
              <Icons name="Sparkles" size={16} aria-hidden="true" />
              {t("home.cta_button")}
            </Link>
          </Button>
        </div>
      </Card>
    </section>
  );
}
