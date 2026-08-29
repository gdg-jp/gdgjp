import { useTranslation } from "react-i18next";
import { STEPS } from "./landing-data";

export function HowItWorksSection() {
  const { t } = useTranslation();
  return (
    <section
      className="px-6 py-24"
      style={{
        background:
          "linear-gradient(180deg, var(--color-surface-canvas) 0%, var(--color-surface-raised) 100%)",
      }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-16 text-center">
          <h2 className="mb-3 text-3xl font-bold text-content-primary sm:text-4xl">
            {t("lp.how_title")}
          </h2>
          <p className="mx-auto max-w-lg text-base text-content-secondary">
            {t("lp.how_subtitle")}
          </p>
        </div>

        <div className="relative flex flex-col gap-10 lg:flex-row lg:gap-0 lg:items-start">
          {/* Desktop connector line */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 hidden lg:block"
            style={{
              top: "36px",
              height: "2px",
              background:
                "linear-gradient(90deg, var(--color-brand-google-blue), var(--color-brand-google-red), var(--color-brand-google-green))",
              opacity: 0.25,
              zIndex: 0,
            }}
          />

          {STEPS.map((step) => (
            <div
              key={step.num}
              className="relative z-10 flex flex-1 flex-col items-center px-4 text-center"
            >
              {/* Icon circle */}
              <div
                className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${step.color.accent}22 0%, ${step.color.accent}44 100%)`,
                  border: `2px solid ${step.color.accent}66`,
                  color: step.color.accent,
                }}
              >
                {step.icon}
              </div>

              {/* Step number badge */}
              <div
                className="mb-3 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-content-inverse"
                style={{ background: step.color.accent }}
              >
                {step.num}
              </div>

              <h3 className="mb-2 font-semibold text-content-primary">{t(step.titleKey)}</h3>
              <p className="text-sm leading-relaxed text-content-secondary">{t(step.descKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
