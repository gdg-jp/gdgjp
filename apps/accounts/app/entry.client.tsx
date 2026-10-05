import i18next from "i18next";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { HydratedRouter } from "react-router/dom";
import { defaultNS, fallbackLng, isLocale, resources, supportedLngs } from "~/lib/i18n/resources";

async function hydrate() {
  const lng = isLocale(document.documentElement.lang) ? document.documentElement.lang : fallbackLng;

  await i18next.use(initReactI18next).init({
    supportedLngs: [...supportedLngs],
    fallbackLng,
    defaultNS,
    resources,
    lng,
    react: { useSuspense: false },
    interpolation: { escapeValue: false },
  });

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <I18nextProvider i18n={i18next}>
          <HydratedRouter />
        </I18nextProvider>
      </StrictMode>,
    );
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void hydrate();
  });
} else {
  void hydrate();
}
