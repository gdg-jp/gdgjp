import { Button, Card, Heading, Icons, Stack, Text } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useCurrentSpace } from "~/features/spaces/components/current-space";
import { spacePath } from "~/features/spaces/shared";

/** How pages come to be in v2: sources in, agent-written pages out; humans write directly too. */
export function HomeCta() {
  const { t } = useTranslation("common");
  const { slug } = useCurrentSpace();

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
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild>
              <Link to={spacePath(slug, "sources")}>
                <Icons name="FileText" size={16} aria-hidden="true" />
                {t("home.cta_button")}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to={spacePath(slug, "wiki/new")}>
                <Icons name="Plus" size={16} aria-hidden="true" />
                {t("home.cta_new_page")}
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
