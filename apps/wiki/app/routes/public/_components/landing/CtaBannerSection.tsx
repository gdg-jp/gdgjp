import { Card, Heading, Stack, Text } from "@gdgjp/design-system";
import type React from "react";
import { useTranslation } from "react-i18next";

export function CtaBannerSection({ ctaSlot }: { ctaSlot: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20">
      <Card className="mx-auto max-w-3xl p-8 text-center sm:p-12">
        <Stack align="center">
          <Heading level={2} className="text-3xl sm:text-4xl">
            {t("lp.cta_title")}
          </Heading>
          <Text tone="muted" className="max-w-md">
            {t("lp.cta_subtitle")}
          </Text>
          {ctaSlot}
        </Stack>
      </Card>
    </section>
  );
}
