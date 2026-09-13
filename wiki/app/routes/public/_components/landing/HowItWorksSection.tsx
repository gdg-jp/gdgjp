import { Badge, Card, Heading, Stack, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { STEPS } from "./landing-data";

export function HowItWorksSection() {
  const { t } = useTranslation();

  return (
    <section className="bg-neutral px-4 py-16 sm:px-6 sm:py-24" aria-labelledby="how-title">
      <div className="mx-auto max-w-4xl">
        <Stack align="center" className="mb-12 text-center">
          <Heading id="how-title" level={2} className="text-3xl sm:text-4xl">
            {t("lp.how_title")}
          </Heading>
          <Text tone="muted" className="max-w-lg">
            {t("lp.how_subtitle")}
          </Text>
        </Stack>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.num}>
              <Card className="h-full p-5 text-center sm:p-6">
                <Stack align="center">
                  <Badge tone="info">{step.num}</Badge>
                  <span className="text-link" aria-hidden="true">
                    {step.icon}
                  </span>
                  <Heading level={3}>{t(step.titleKey)}</Heading>
                  <Text size="sm" tone="muted">
                    {t(step.descKey)}
                  </Text>
                </Stack>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
