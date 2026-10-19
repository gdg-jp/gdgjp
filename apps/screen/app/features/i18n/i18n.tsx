import { type ReactNode, createContext, useCallback, useContext, useState } from "react";
import { LANG_COOKIE, type Lang, MESSAGES, type MessageKey } from "./messages";

type I18n = { lang: Lang; t: (key: MessageKey) => string; setLang: (lang: Lang) => void };

const I18nContext = createContext<I18n>({
  lang: "ja",
  t: (key) => MESSAGES.ja[key],
  setLang: () => {},
});

export function I18nProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);
  const t = useCallback((key: MessageKey) => MESSAGES[lang][key], [lang]);
  return <I18nContext.Provider value={{ lang, t, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
