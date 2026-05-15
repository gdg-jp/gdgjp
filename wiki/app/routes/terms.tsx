import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "Terms of Service — GDGoC Japan Wiki" }];

export default function TermsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <Link to="/" className="text-sm font-medium text-blue-600 hover:text-blue-800">
          {t("terms.back")}
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <article className="prose prose-gray max-w-none">
          <h1 className="text-2xl font-bold text-gray-900">{t("terms.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("terms.last_updated")}</p>

          <h2 className="mt-8 text-lg font-semibold text-gray-800">{t("terms.s1_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("terms.s1_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("terms.s2_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("terms.s2_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("terms.s3_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("terms.s3_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("terms.s4_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("terms.s4_intro")}</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-600">
            <li>{t("terms.s4_item1")}</li>
            <li>{t("terms.s4_item2")}</li>
            <li>{t("terms.s4_item3")}</li>
            <li>{t("terms.s4_item4")}</li>
          </ul>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("terms.s5_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("terms.s5_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-gray-800">{t("terms.s6_heading")}</h2>
          <p className="mt-2 text-sm text-gray-600">{t("terms.s6_body")}</p>
        </article>
      </main>

      <footer className="border-t border-gray-200 bg-white px-6 py-4 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} GDGoC Japan ·{" "}
        <Link to="/privacy" className="hover:text-blue-500">
          {t("terms.footer_link")}
        </Link>
      </footer>
    </div>
  );
}
