import i18next from "i18next";
import { config as mdEditorConfig } from "md-editor-rt";
import mermaid from "mermaid";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { HydratedRouter } from "react-router/dom";
import {
  localCursorReporter,
  remoteCursorsExtension,
} from "./features/editor/remote-cursors-extension";
import { defaultNS, fallbackLng, supportedLngs } from "./i18n";
import enCommon from "./locales/en/common.json";
import jaCommon from "./locales/ja/common.json";

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

    const savedLang = localStorage.getItem("ui_lang");
    if (savedLang && savedLang !== i18next.language) {
      i18next.changeLanguage(savedLang);
    }
  });
