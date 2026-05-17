import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "Privacy Policy — GDG Japan Wiki" }];

export default function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <Link to="/" className="text-sm font-medium text-blue-600 hover:text-blue-800">
          {t("privacy.back")}
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <article className="prose prose-gray max-w-none">
          <h1 className="text-2xl font-bold text-gray-900">{t("privacy.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("privacy.last_updated")}</p>

          <h2 className="mt-8 text-lg font-semibold text-gray-800">{t("privacy.s1_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("privacy.s1_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("privacy.s2_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("privacy.s2_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("privacy.s3_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("privacy.s3_intro")}</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-600">
            <li>
              <strong>Google OAuth</strong> —{" "}
              <Trans
                i18nKey="privacy.s3_google"
                components={{
                  googlePolicy: (
                    <a
                      href="https://policies.google.com/privacy"
                      className="text-blue-600 hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {" "}
                    </a>
                  ),
                }}
              />
            </li>
            <li>
              <strong>Cloudflare</strong> —{" "}
              <Trans
                i18nKey="privacy.s3_cloudflare"
                components={{
                  cloudflarePolicy: (
                    <a
                      href="https://www.cloudflare.com/privacypolicy/"
                      className="text-blue-600 hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {" "}
                    </a>
                  ),
                }}
              />
            </li>
            <li>
              <strong>Google Gemini API</strong> — {t("privacy.s3_gemini")}
            </li>
          </ul>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("privacy.s4_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("privacy.s4_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("privacy.s5_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("privacy.s5_body")}</p>
        </article>
      </main>

      <footer className="border-t border-gray-200 bg-white px-6 py-4 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} GDG Japan ·{" "}
        <Link to="/terms" className="hover:text-blue-500">
          {t("privacy.footer_link")}
        </Link>
      </footer>
    </div>
  );
}
