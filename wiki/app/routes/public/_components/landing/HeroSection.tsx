import type React from "react";
import { useTranslation } from "react-i18next";

export function HeroSection({ ctaSlot }: { ctaSlot: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <section
        className="relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, var(--color-brand-google-blue-soft) 0%, var(--color-brand-google-yellow-soft) 35%, var(--color-brand-google-red-soft) 65%, var(--color-brand-google-green-soft) 100%)",
          minHeight: "88vh",
        }}
      >
        {/* Mesh blobs */}
        <div
          aria-hidden="true"
          className="lp-floating-decoration"
          style={{
            position: "absolute",
            top: "-120px",
            left: "-120px",
            width: "480px",
            height: "480px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-brand-google-blue) 25%, transparent) 0%, transparent 70%)",
            filter: "blur(40px)",
            animation: "lp-float 8s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          className="lp-floating-decoration"
          style={{
            position: "absolute",
            top: "-80px",
            right: "-80px",
            width: "360px",
            height: "360px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-brand-google-red) 25%, transparent) 0%, transparent 70%)",
            filter: "blur(40px)",
            animation: "lp-float 10s ease-in-out infinite reverse",
          }}
        />
        <div
          aria-hidden="true"
          className="lp-floating-decoration"
          style={{
            position: "absolute",
            bottom: "-100px",
            left: "30%",
            width: "420px",
            height: "420px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-brand-google-green) 20%, transparent) 0%, transparent 70%)",
            filter: "blur(50px)",
            animation: "lp-float 12s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          className="lp-floating-decoration"
          style={{
            position: "absolute",
            bottom: "-60px",
            right: "10%",
            width: "300px",
            height: "300px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-brand-google-yellow) 25%, transparent) 0%, transparent 70%)",
            filter: "blur(40px)",
            animation: "lp-float 9s ease-in-out infinite reverse",
          }}
        />

        {/* Floating GDG dots — decorative */}
        <div
          aria-hidden="true"
          className="absolute lp-floating-decoration"
          style={{
            top: "18%",
            left: "8%",
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "var(--color-brand-google-blue)",
            opacity: 0.7,
            animation: "lp-float 6s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute lp-floating-decoration"
          style={{
            top: "25%",
            right: "12%",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--color-brand-google-red)",
            opacity: 0.7,
            animation: "lp-float 7s ease-in-out infinite reverse",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute lp-floating-decoration"
          style={{
            bottom: "28%",
            left: "15%",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "var(--color-brand-google-green)",
            opacity: 0.7,
            animation: "lp-float 8s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute lp-floating-decoration"
          style={{
            bottom: "22%",
            right: "18%",
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "var(--color-brand-google-yellow)",
            opacity: 0.7,
            animation: "lp-float 5s ease-in-out infinite reverse",
          }}
        />

        {/* Tiny squares */}
        <div
          aria-hidden="true"
          className="absolute lp-floating-decoration"
          style={{
            top: "40%",
            left: "5%",
            width: 10,
            height: 10,
            borderRadius: 3,
            background: "var(--color-brand-google-yellow)",
            opacity: 0.5,
            rotate: "15deg",
            animation: "lp-float 11s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute lp-floating-decoration"
          style={{
            top: "55%",
            right: "6%",
            width: 10,
            height: 10,
            borderRadius: 3,
            background: "var(--color-brand-google-blue)",
            opacity: 0.5,
            rotate: "-20deg",
            animation: "lp-float 9s ease-in-out infinite reverse",
          }}
        />

        {/* Content */}
        <div className="relative z-10 mx-auto flex min-h-[88vh] max-w-4xl flex-col items-center justify-center px-6 py-24 text-center">
          {/* Pill badge */}
          <div
            className="mb-7 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold"
            style={{
              background: "color-mix(in srgb, var(--color-surface-raised) 75%, transparent)",
              backdropFilter: "blur(8px)",
              border:
                "1.5px solid color-mix(in srgb, var(--color-brand-google-blue) 25%, transparent)",
              color: "var(--color-brand-google-blue)",
              boxShadow:
                "0 2px 12px color-mix(in srgb, var(--color-brand-google-blue) 10%, transparent)",
            }}
          >
            {/* GDG colored dots */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-brand-google-blue)",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-brand-google-red)",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-brand-google-yellow)",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-brand-google-green)",
                display: "inline-block",
              }}
            />
            <span className="ml-1">{t("lp.badge")}</span>
          </div>

          <h1
            className="mb-6 text-5xl font-bold tracking-tight text-content-primary sm:text-6xl lg:text-7xl"
            style={{ lineHeight: 1.1 }}
          >
            {t("lp.hero_title")}
          </h1>

          <p
            className="mx-auto mb-10 max-w-xl text-lg text-content-secondary sm:text-xl"
            style={{ lineHeight: 1.65 }}
          >
            {t("lp.hero_subtitle")}
          </p>

          {ctaSlot}
        </div>
      </section>

      {/* Inline keyframes for float animation */}
      <style>{`
        @keyframes lp-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-14px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-floating-decoration {
            animation: none !important;
            transform: none !important;
          }
        }
        .lp-feature-card {
          transition: transform 0.22s cubic-bezier(.22,1,.36,1), box-shadow 0.22s cubic-bezier(.22,1,.36,1);
        }
        .lp-feature-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 20px 40px color-mix(in srgb, var(--color-content-primary) 10%, transparent);
        }
      `}</style>
    </>
  );
}
