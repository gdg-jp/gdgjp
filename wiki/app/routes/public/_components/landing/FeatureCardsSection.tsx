import { useTranslation } from "react-i18next";
import { FEATURES } from "./landing-data";

export function FeatureCardsSection() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="mb-14 text-center">
        <h2 className="mb-3 text-3xl font-bold text-content-primary sm:text-4xl">
          {t("lp.features_title")}
        </h2>
        <p className="mx-auto max-w-xl text-base text-content-secondary">
          {t("lp.features_subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div
            key={f.key}
            className="lp-feature-card flex flex-col gap-4 rounded-2xl bg-surface-raised p-6"
            style={{
              border: `1.5px solid ${f.color.accent}22`,
              boxShadow: `0 4px 24px ${f.color.accent}12`,
            }}
          >
            {/* Colored top stripe */}
            <div className="mb-1 h-1 w-12 rounded-full" style={{ background: f.color.accent }} />

            {/* Icon */}
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{ background: f.color.bg, color: f.color.text }}
            >
              {f.icon}
            </div>

            <h3 className="font-semibold text-content-primary">{t(f.titleKey)}</h3>
            <p className="text-sm leading-relaxed text-content-secondary">{t(f.descKey)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
