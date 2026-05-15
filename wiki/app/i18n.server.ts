import { RemixI18Next } from "remix-i18next/server";
import { defaultNS, fallbackLng, supportedLngs } from "./i18n";
import enCommon from "./locales/en/common.json";
import jaCommon from "./locales/ja/common.json";

export const i18nextServer = new RemixI18Next({
  detection: { supportedLanguages: [...supportedLngs], fallbackLanguage: fallbackLng },
  i18next: {
    defaultNS,
    fallbackLng,
    resources: { ja: { common: jaCommon }, en: { common: enCommon } },
  },
});
