import { useTranslation } from "react-i18next";
import { Link } from "react-router";

// ---------------------------------------------------------------------------
// Google icon (for sign-in button)
// ---------------------------------------------------------------------------

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function IconBrain() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

function IconBookOpen() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// GDG color palette tokens
// ---------------------------------------------------------------------------

const GDG = {
  blue: { bg: "#e8f0fe", text: "#1a73e8", accent: "#4285f4" },
  green: { bg: "#e6f4ea", text: "#188038", accent: "#34a853" },
  yellow: { bg: "#fef7e0", text: "#e37400", accent: "#f9ab00" },
  red: { bg: "#fce8e6", text: "#c5221f", accent: "#ea4335" },
} as const;

// ---------------------------------------------------------------------------
// Feature card data
// ---------------------------------------------------------------------------

type Feature = {
  key: string;
  titleKey: string;
  descKey: string;
  color: (typeof GDG)[keyof typeof GDG];
  icon: React.ReactNode;
};

const FEATURES: Feature[] = [
  {
    key: "ingest",
    titleKey: "lp.feature_ingest_title",
    descKey: "lp.feature_ingest_desc",
    color: GDG.blue,
    icon: <IconBrain />,
  },
  {
    key: "bilingual",
    titleKey: "lp.feature_bilingual_title",
    descKey: "lp.feature_bilingual_desc",
    color: GDG.green,
    icon: <IconGlobe />,
  },
  {
    key: "kb",
    titleKey: "lp.feature_kb_title",
    descKey: "lp.feature_kb_desc",
    color: GDG.yellow,
    icon: <IconBookOpen />,
  },
  {
    key: "members",
    titleKey: "lp.feature_members_title",
    descKey: "lp.feature_members_desc",
    color: GDG.red,
    icon: <IconUsers />,
  },
];

// ---------------------------------------------------------------------------
// How It Works steps
// ---------------------------------------------------------------------------

type Step = {
  num: number;
  titleKey: string;
  descKey: string;
  icon: React.ReactNode;
  color: (typeof GDG)[keyof typeof GDG];
};

const STEPS: Step[] = [
  {
    num: 1,
    titleKey: "lp.how_step1_title",
    descKey: "lp.how_step1_desc",
    icon: <IconUpload />,
    color: GDG.blue,
  },
  {
    num: 2,
    titleKey: "lp.how_step2_title",
    descKey: "lp.how_step2_desc",
    icon: <IconSparkles />,
    color: GDG.red,
  },
  {
    num: 3,
    titleKey: "lp.how_step3_title",
    descKey: "lp.how_step3_desc",
    icon: <IconCheck />,
    color: GDG.green,
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type LandingContentProps = {
  /** CTA slot rendered in the hero (e.g. "Sign in" or "Go to Home"). */
  ctaSlot: React.ReactNode;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LandingContent({ ctaSlot }: LandingContentProps) {
  const { t } = useTranslation();

  return (
    <div className="force-light min-h-screen bg-white font-sans">
      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section
        className="relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #e8f0fe 0%, #fef7e0 35%, #fce8e6 65%, #e6f4ea 100%)",
          minHeight: "88vh",
        }}
      >
        {/* Mesh blobs */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "-120px",
            left: "-120px",
            width: "480px",
            height: "480px",
            borderRadius: "50%",
            background: "radial-gradient(circle, #4285f440 0%, transparent 70%)",
            filter: "blur(40px)",
            animation: "lp-float 8s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "-80px",
            right: "-80px",
            width: "360px",
            height: "360px",
            borderRadius: "50%",
            background: "radial-gradient(circle, #ea433540 0%, transparent 70%)",
            filter: "blur(40px)",
            animation: "lp-float 10s ease-in-out infinite reverse",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "-100px",
            left: "30%",
            width: "420px",
            height: "420px",
            borderRadius: "50%",
            background: "radial-gradient(circle, #34a85330 0%, transparent 70%)",
            filter: "blur(50px)",
            animation: "lp-float 12s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "-60px",
            right: "10%",
            width: "300px",
            height: "300px",
            borderRadius: "50%",
            background: "radial-gradient(circle, #f9ab0040 0%, transparent 70%)",
            filter: "blur(40px)",
            animation: "lp-float 9s ease-in-out infinite reverse",
          }}
        />

        {/* Floating GDG dots — decorative */}
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            top: "18%",
            left: "8%",
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#4285f4",
            opacity: 0.7,
            animation: "lp-float 6s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            top: "25%",
            right: "12%",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#ea4335",
            opacity: 0.7,
            animation: "lp-float 7s ease-in-out infinite reverse",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            bottom: "28%",
            left: "15%",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#34a853",
            opacity: 0.7,
            animation: "lp-float 8s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            bottom: "22%",
            right: "18%",
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#f9ab00",
            opacity: 0.7,
            animation: "lp-float 5s ease-in-out infinite reverse",
          }}
        />

        {/* Tiny squares */}
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            top: "40%",
            left: "5%",
            width: 10,
            height: 10,
            borderRadius: 3,
            background: "#f9ab00",
            opacity: 0.5,
            transform: "rotate(15deg)",
            animation: "lp-float 11s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            top: "55%",
            right: "6%",
            width: 10,
            height: 10,
            borderRadius: 3,
            background: "#4285f4",
            opacity: 0.5,
            transform: "rotate(-20deg)",
            animation: "lp-float 9s ease-in-out infinite reverse",
          }}
        />

        {/* Content */}
        <div className="relative z-10 mx-auto flex min-h-[88vh] max-w-4xl flex-col items-center justify-center px-6 py-24 text-center">
          {/* Pill badge */}
          <div
            className="mb-7 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold"
            style={{
              background: "rgba(255,255,255,0.75)",
              backdropFilter: "blur(8px)",
              border: "1.5px solid rgba(66,133,244,0.25)",
              color: "#1a73e8",
              boxShadow: "0 2px 12px rgba(66,133,244,0.10)",
            }}
          >
            {/* GDG colored dots */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#4285f4",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ea4335",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#f9ab00",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#34a853",
                display: "inline-block",
              }}
            />
            <span className="ml-1">{t("lp.badge")}</span>
          </div>

          <h1
            className="mb-6 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl lg:text-7xl"
            style={{ lineHeight: 1.1 }}
          >
            {t("lp.hero_title")}
          </h1>

          <p
            className="mx-auto mb-10 max-w-xl text-lg text-gray-600 sm:text-xl"
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
        .lp-feature-card {
          transition: transform 0.22s cubic-bezier(.22,1,.36,1), box-shadow 0.22s cubic-bezier(.22,1,.36,1);
        }
        .lp-feature-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 20px 40px rgba(0,0,0,0.10);
        }
      `}</style>

      {/* ------------------------------------------------------------------ */}
      {/* Feature cards                                                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="mb-14 text-center">
          <h2 className="mb-3 text-3xl font-bold text-gray-900 sm:text-4xl">
            {t("lp.features_title")}
          </h2>
          <p className="mx-auto max-w-xl text-base text-gray-500">{t("lp.features_subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.key}
              className="lp-feature-card flex flex-col gap-4 rounded-2xl bg-white p-6"
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

              <h3 className="font-semibold text-gray-900">{t(f.titleKey)}</h3>
              <p className="text-sm leading-relaxed text-gray-500">{t(f.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* How It Works                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section
        className="px-6 py-24"
        style={{ background: "linear-gradient(180deg, #f8f9fa 0%, #ffffff 100%)" }}
      >
        <div className="mx-auto max-w-4xl">
          <div className="mb-16 text-center">
            <h2 className="mb-3 text-3xl font-bold text-gray-900 sm:text-4xl">
              {t("lp.how_title")}
            </h2>
            <p className="mx-auto max-w-lg text-base text-gray-500">{t("lp.how_subtitle")}</p>
          </div>

          <div className="relative flex flex-col gap-10 lg:flex-row lg:gap-0 lg:items-start">
            {/* Desktop connector line */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 hidden lg:block"
              style={{
                top: "36px",
                height: "2px",
                background: "linear-gradient(90deg, #4285f4, #ea4335, #34a853)",
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
                  className="mb-3 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: step.color.accent }}
                >
                  {step.num}
                </div>

                <h3 className="mb-2 font-semibold text-gray-900">{t(step.titleKey)}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{t(step.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CTA Banner                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="px-6 py-20">
        <div
          className="mx-auto max-w-3xl rounded-3xl px-8 py-16 text-center"
          style={{
            background: "linear-gradient(135deg, #4285f4 0%, #1a73e8 40%, #34a853 100%)",
            boxShadow: "0 24px 64px rgba(66,133,244,0.30)",
          }}
        >
          <h2 className="mb-3 text-3xl font-bold text-white sm:text-4xl">{t("lp.cta_title")}</h2>
          <p className="mx-auto mb-10 max-w-md text-base text-white/80">{t("lp.cta_subtitle")}</p>
          {ctaSlot}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-gray-100 px-6 py-8 text-center">
        <div className="mb-4 flex items-center justify-center gap-2">
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#4285f4",
              display: "inline-block",
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#ea4335",
              display: "inline-block",
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#f9ab00",
              display: "inline-block",
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#34a853",
              display: "inline-block",
            }}
          />
        </div>
        <div className="flex justify-center gap-6 text-sm text-gray-400">
          <Link to="/privacy" className="transition-colors hover:text-blue-500">
            {t("footer.privacy")}
          </Link>
          <Link to="/terms" className="transition-colors hover:text-blue-500">
            {t("footer.terms")}
          </Link>
        </div>
      </footer>
    </div>
  );
}

export { GoogleIcon };
