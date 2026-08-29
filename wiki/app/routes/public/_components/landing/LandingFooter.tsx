import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-subtle px-6 py-8 text-center">
      <div className="mb-4 flex items-center justify-center gap-2">
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--color-brand-google-blue)",
            display: "inline-block",
          }}
        />
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--color-brand-google-red)",
            display: "inline-block",
          }}
        />
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--color-brand-google-yellow)",
            display: "inline-block",
          }}
        />
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--color-brand-google-green)",
            display: "inline-block",
          }}
        />
      </div>
      <div className="flex justify-center gap-6 text-sm text-content-tertiary">
        <Link to="/privacy" className="transition-colors hover:text-action-primary">
          {t("footer.privacy")}
        </Link>
        <Link to="/terms" className="transition-colors hover:text-action-primary">
          {t("footer.terms")}
        </Link>
      </div>
    </footer>
  );
}
