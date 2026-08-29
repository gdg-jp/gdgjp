import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "Terms of Service — GDG Japan Wiki" }];

export default function TermsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken">
      <header className="border-b border-border-default bg-surface-raised px-6 py-4">
        <Link
          to="/"
          className="text-sm font-medium text-action-primary hover:text-action-primary-hover"
        >
          {t("terms.back")}
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <article className="prose prose-gray max-w-none">
          <h1 className="text-2xl font-bold text-content-primary">{t("terms.title")}</h1>
          <p className="mt-1 text-sm text-content-tertiary">{t("terms.last_updated")}</p>

          <h2 className="mt-8 text-lg font-semibold text-content-primary">
            {t("terms.s1_heading")}
          </h2>
          <p className="mt-2 text-sm text-content-secondary">{t("terms.s1_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-content-primary">
            {t("terms.s2_heading")}
          </h2>
          <p className="mt-2 text-sm text-content-secondary">{t("terms.s2_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-content-primary">
            {t("terms.s3_heading")}
          </h2>
          <p className="mt-2 text-sm text-content-secondary">{t("terms.s3_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-content-primary">
            {t("terms.s4_heading")}
          </h2>
          <p className="mt-2 text-sm text-content-secondary">{t("terms.s4_intro")}</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-content-secondary">
            <li>{t("terms.s4_item1")}</li>
            <li>{t("terms.s4_item2")}</li>
            <li>{t("terms.s4_item3")}</li>
            <li>{t("terms.s4_item4")}</li>
          </ul>

          <h2 className="mt-6 text-lg font-semibold text-content-primary">
            {t("terms.s5_heading")}
          </h2>
          <p className="mt-2 text-sm text-content-secondary">{t("terms.s5_body")}</p>

          <h2 className="mt-6 text-lg font-semibold text-content-primary">
            {t("terms.s6_heading")}
          </h2>
          <p className="mt-2 text-sm text-content-secondary">{t("terms.s6_body")}</p>
        </article>
      </main>

      <footer className="border-t border-border-default bg-surface-raised px-6 py-4 text-center text-xs text-content-disabled">
        © {new Date().getFullYear()} GDG Japan ·{" "}
        <Link to="/privacy" className="hover:text-action-primary">
          {t("terms.footer_link")}
        </Link>
      </footer>
    </div>
  );
}
