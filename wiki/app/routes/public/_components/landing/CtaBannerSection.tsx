import type React from "react";
import { useTranslation } from "react-i18next";

export function CtaBannerSection({ ctaSlot }: { ctaSlot: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="px-6 py-20">
      <div
        className="mx-auto max-w-3xl rounded-3xl px-8 py-16 text-center"
        style={{
          background:
            "linear-gradient(135deg, var(--color-brand-google-blue) 0%, var(--color-brand-google-blue) 40%, var(--color-brand-google-green) 100%)",
          boxShadow:
            "0 24px 64px color-mix(in srgb, var(--color-brand-google-blue) 30%, transparent)",
        }}
      >
        <h2 className="mb-3 text-3xl font-bold text-content-inverse sm:text-4xl">
          {t("lp.cta_title")}
        </h2>
        <p className="mx-auto mb-10 max-w-md text-base text-content-inverse/80">
          {t("lp.cta_subtitle")}
        </p>
        {ctaSlot}
      </div>
    </section>
  );
}
