import { ToggleGroup, ToggleGroupItem } from "@gdgjp/design-system";
import { useI18n } from "~/features/i18n/i18n";
import { isLang } from "~/features/i18n/messages";

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <ToggleGroup
      type="single"
      value={lang}
      onValueChange={(v) => isLang(v) && setLang(v)}
      aria-label="Language"
      className="sc-lang"
    >
      <ToggleGroupItem value="ja" aria-label="日本語">
        日本語
      </ToggleGroupItem>
      <ToggleGroupItem value="en" aria-label="English">
        EN
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
