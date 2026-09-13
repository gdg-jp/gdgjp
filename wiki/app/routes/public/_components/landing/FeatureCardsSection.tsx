import { Card, Heading, Stack, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { FEATURES } from "./landing-data";

export function FeatureCardsSection() {
  const { t } = useTranslation();

  return (
    <section
      className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
      aria-labelledby="features-title"
    >
      <Stack align="center" className="mb-12 text-center">
        <Heading id="features-title" level={2} className="text-3xl sm:text-4xl">
          {t("lp.features_title")}
        </Heading>
        <Text tone="muted" className="max-w-xl">
          {t("lp.features_subtitle")}
        </Text>
      </Stack>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <li key={feature.key}>
            <Card className="h-full p-5 sm:p-6">
              <Stack>
                <span className="text-link" aria-hidden="true">
                  {feature.icon}
                </span>
                <Heading level={3}>{t(feature.titleKey)}</Heading>
                <Text size="sm" tone="muted">
                  {t(feature.descKey)}
                </Text>
              </Stack>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
