import i18next from "i18next";
import { config as mdEditorConfig } from "md-editor-rt";
import mermaid from "mermaid";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { HydratedRouter } from "react-router/dom";
import { defaultNS, fallbackLng, supportedLngs } from "./i18n";
import { localCursorReporter, remoteCursorsExtension } from "./lib/remote-cursors-extension";
import enCommon from "./locales/en/common.json";
import jaCommon from "./locales/ja/common.json";

// Configure md-editor-rt to use mermaid for diagram rendering and add remote cursor extensions
mdEditorConfig({
  editorExtensions: { mermaid: { instance: mermaid } },
  codeMirrorExtensions(extensions, { editorId }) {
    return [
      ...extensions,
      { type: "remoteCursors", extension: remoteCursorsExtension(editorId) },
      { type: "localCursorReporter", extension: localCursorReporter(editorId) },
    ];
  },
});

// Initialize with the SSR locale so hydration matches the server-rendered HTML.
i18next
  .use(initReactI18next)
  .init({
    lng: document.documentElement.lang || fallbackLng,
    fallbackLng,
    supportedLngs: [...supportedLngs],
    defaultNS,
    resources: { ja: { common: jaCommon }, en: { common: enCommon } },
    interpolation: { escapeValue: false },
  })
  .then(() => {
    startTransition(() => {
      hydrateRoot(
        document,
        <StrictMode>
          <HydratedRouter />
        </StrictMode>,
      );
    });

    // After hydration, apply any localStorage preference that differs from the SSR locale.
    const savedLang = localStorage.getItem("ui_lang");
    if (savedLang && savedLang !== i18next.language) {
      i18next.changeLanguage(savedLang);
    }
  });
