import { createInstance } from "i18next";
import { renderToReadableStream } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { defaultNS, fallbackLng, supportedLngs } from "./i18n";
import { i18nextServer } from "./i18n.server";
import enCommon from "./locales/en/common.json";
import jaCommon from "./locales/ja/common.json";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  // Create a fresh i18next instance per request so concurrent requests don't
  // share mutable language state (important for Cloudflare Workers isolates).
  const instance = createInstance();
  const lng = await i18nextServer.getLocale(request);
  await instance.use(initReactI18next).init({
    lng,
    fallbackLng,
    supportedLngs: [...supportedLngs],
    defaultNS,
    resources: { ja: { common: jaCommon }, en: { common: enCommon } },
    interpolation: { escapeValue: false },
  });

  let statusCode = responseStatusCode;
  const body = await renderToReadableStream(
    <I18nextProvider i18n={instance}>
      <ServerRouter context={routerContext} url={request.url} />
    </I18nextProvider>,
    {
      signal: request.signal,
      onError(error: unknown) {
        console.error(error);
        statusCode = 500;
      },
    },
  );

  responseHeaders.set("Content-Type", "text/html");

  return new Response(body, {
    headers: responseHeaders,
    status: statusCode,
  });
}
