import { useTranslation } from "react-i18next";

export default function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-200 bg-white px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>© {year} GDGoC Japan</span>
        <div className="flex items-center gap-4">
          <a href="/privacy" className="transition-colors hover:text-blue-500">
            {t("footer.privacy")}
          </a>
          <a href="/terms" className="transition-colors hover:text-blue-500">
            {t("footer.terms")}
          </a>
          <a
            href="https://github.com/gdgoc-osaka/gdgjp"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-blue-500"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
