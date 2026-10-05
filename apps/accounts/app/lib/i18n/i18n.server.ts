import { createCookie } from "react-router";
import { RemixI18Next } from "remix-i18next/server";
import { defaultNS, fallbackLng, resources, supportedLngs } from "./resources";

export const localeCookie = createCookie("i18next", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: import.meta.env.PROD,
  maxAge: 60 * 60 * 24 * 365,
});

export const i18n = new RemixI18Next({
  detection: {
    supportedLanguages: [...supportedLngs],
    fallbackLanguage: fallbackLng,
    cookie: localeCookie,
    order: ["cookie", "header"],
  },
  i18next: {
    supportedLngs: [...supportedLngs],
    fallbackLng,
    defaultNS,
    resources,
  },
});
