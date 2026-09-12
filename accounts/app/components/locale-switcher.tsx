import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Icons,
} from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { useLocation, useSubmit } from "react-router";
import { type Locale, supportedLngs } from "~/lib/i18n/resources";

export function LocaleSwitcher() {
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const submit = useSubmit();
  const resolved = i18n.resolvedLanguage;
  const current: Locale =
    resolved !== undefined && supportedLngs.includes(resolved as Locale)
      ? (resolved as Locale)
      : supportedLngs[0];
  const returnTo = `${location.pathname}${location.search}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" aria-label={t("nav.localeLabel")}>
          <Icons name="Languages" size={18} aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            if (!supportedLngs.includes(value as Locale) || current === value) return;
            const data = new FormData();
            data.set("locale", value);
            data.set("return_to", returnTo);
            void submit(data, { method: "post", action: "/api/locale", replace: true });
          }}
        >
          {supportedLngs.map((lng) => (
            <DropdownMenuRadioItem key={lng} value={lng}>
              <span>{lng === "ja" ? t("nav.localeJa") : t("nav.localeEn")}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
