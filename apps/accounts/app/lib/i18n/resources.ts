import en from "~/locales/en/common.json";
import ja from "~/locales/ja/common.json";

export const supportedLngs = ["ja", "en"] as const;
export type Locale = (typeof supportedLngs)[number];
export const fallbackLng: Locale = "ja";
export const defaultNS = "common";

export const resources = {
  ja: { common: ja },
  en: { common: en },
} as const;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (supportedLngs as readonly string[]).includes(value);
}
