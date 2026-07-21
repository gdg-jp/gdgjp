import { AlertTriangle, ServerCrash } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "react-router";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { type SupportedLng, supportedLngs } from "./i18n";
import { i18nextServer } from "./i18n.server";
import { FirebaseConfigContext } from "./lib/firebase-config-context";

import appStylesHref from "./app.css?url";

export const links: LinksFunction = () => [
  { rel: "icon", href: "/app-icon.png", type: "image/png" },
  { rel: "apple-touch-icon", href: "/app-icon.png" },
  {
    rel: "preconnect",
    href: "https://fonts.googleapis.com",
  },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap",
  },
  { rel: "stylesheet", href: appStylesHref },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  // Prefer the persisted ui_lang cookie so SSR language matches the user's
  // saved preference, falling back to Accept-Language detection.
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookieLang = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("ui_lang="))
    ?.split("=")[1];
  const detected = await i18nextServer.getLocale(request);
  const locale: SupportedLng =
    cookieLang && (supportedLngs as readonly string[]).includes(cookieLang)
      ? (cookieLang as SupportedLng)
      : (detected as SupportedLng);
  const cookieTheme = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("theme="))
    ?.split("=")[1];
  const theme = cookieTheme === "dark" ? "dark" : "light";
  const origin = new URL(request.url).origin;

  const firebaseConfig =
    env.FIREBASE_PROJECT_ID && env.FIREBASE_PROJECT_ID !== "REPLACE_ME"
      ? {
          apiKey: env.FIREBASE_API_KEY,
          authDomain: env.FIREBASE_AUTH_DOMAIN,
          projectId: env.FIREBASE_PROJECT_ID,
          messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
          appId: env.FIREBASE_APP_ID,
          vapidKey: env.FIREBASE_VAPID_KEY,
        }
      : null;

  return { locale, theme, origin, firebaseConfig };
}

export const meta: MetaFunction<typeof loader> = () => [
  { property: "og:site_name", content: "GDG Japan Wiki" },
];

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const is404 = status === 404;
  const Icon = is404 ? AlertTriangle : ServerCrash;
  const { t, i18n } = useTranslation();

  return (
    <html lang={i18n.language} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="/theme-init.js" />
        <Meta />
        <Links />
      </head>
      <body className="bg-background text-foreground antialiased">
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
          <Icon className="w-16 h-16 text-blue-500" strokeWidth={1.5} />
          <div className="text-center space-y-2">
            <p className="text-8xl font-bold text-gray-200">{status}</p>
            <h1 className="text-2xl font-semibold">
              {is404 ? t("error.404_title") : t("error.500_title")}
            </h1>
            <p className="text-gray-500 max-w-sm">
              {is404 ? t("error.404_desc") : t("error.500_desc")}
            </p>
          </div>
          <a
            href="/"
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            {t("error.back_home")}
          </a>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { locale, theme, firebaseConfig } = useLoaderData<typeof loader>();

  return (
    <html lang={locale} className={theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="/theme-init.js" />
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-K7FMPPSCPY" />
        <script src="/gtag-init.js" />
        <Meta />
        <Links />
      </head>
      <body className="bg-background text-foreground antialiased">
        <FirebaseConfigContext value={firebaseConfig}>
          <Outlet />
        </FirebaseConfigContext>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
