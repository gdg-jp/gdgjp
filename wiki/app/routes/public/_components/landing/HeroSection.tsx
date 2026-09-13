import { Badge, Heading, Stack, Text } from "@gdgjp/ui";
import type React from "react";
import { useTranslation } from "react-i18next";

export function HeroSection({ ctaSlot }: { ctaSlot: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <section className="mx-auto flex min-h-[min(88vh,48rem)] max-w-4xl items-center px-4 py-16 sm:px-6 sm:py-24">
      <Stack align="center" className="w-full text-center">
        <Badge tone="info">{t("lp.badge")}</Badge>
        <Heading level={1} className="max-w-3xl text-4xl sm:text-5xl lg:text-6xl">
          {t("lp.hero_title")}
        </Heading>
        <Text size="md" tone="muted" className="max-w-xl sm:text-lg">
          {t("lp.hero_subtitle")}
        </Text>
        {ctaSlot}
      </Stack>
    </section>
  );
}
