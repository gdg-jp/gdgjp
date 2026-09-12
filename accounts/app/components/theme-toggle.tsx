import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Icons,
  useTheme,
} from "@gdgjp/ui";
import { useTranslation } from "react-i18next";

const OPTIONS: {
  value: "light" | "dark" | "system";
  labelKey: "nav.themeLight" | "nav.themeDark" | "nav.themeSystem";
  icon: "Sun" | "Moon" | "SunMoon";
}[] = [
  { value: "light", labelKey: "nav.themeLight", icon: "Sun" },
  { value: "dark", labelKey: "nav.themeDark", icon: "Moon" },
  { value: "system", labelKey: "nav.themeSystem", icon: "SunMoon" },
];

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" aria-label={t("nav.toggleTheme")}>
          <Icons name="Sun" size={18} aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (OPTIONS.some((option) => option.value === value)) {
              setTheme(value as (typeof OPTIONS)[number]["value"]);
            }
          }}
        >
          {OPTIONS.map(({ value, labelKey, icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icons name={icon} size={16} aria-hidden="true" />
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
