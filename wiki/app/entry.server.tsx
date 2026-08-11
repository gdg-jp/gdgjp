import { createInstance } from "i18next";
import { isbot } from "isbot";
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

  let shellRendered = false;
  let statusCode = responseStatusCode;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <I18nextProvider i18n={instance}>
      <ServerRouter context={routerContext} url={request.url} />
    </I18nextProvider>,
    {
      signal: request.signal,
      onError(error: unknown) {
        statusCode = 500;
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  // Bots and SPA mode need the full document (including deferred Suspense data)
  // before the response finishes. Humans get progressive streaming.
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");

  return new Response(body, {
    headers: responseHeaders,
    status: statusCode,
  });
}
