import { Inline, Text, Link as UiLink } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t px-4 py-8 sm:px-6">
      <Inline className="justify-center">
        <Text size="sm" tone="muted">
          © {new Date().getFullYear()} GDG Japan
        </Text>
        <UiLink asChild>
          <Link to="/privacy">{t("footer.privacy")}</Link>
        </UiLink>
        <UiLink asChild>
          <Link to="/terms">{t("footer.terms")}</Link>
        </UiLink>
      </Inline>
    </footer>
  );
}
