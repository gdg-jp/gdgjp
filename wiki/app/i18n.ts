export const supportedLngs = ["ja", "en"] as const;
export type SupportedLng = (typeof supportedLngs)[number];
export const fallbackLng: SupportedLng = "ja";
export const defaultNS = "common";
