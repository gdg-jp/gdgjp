import { Button, Icons, ThemeProvider, Toaster } from "@gdgjp/ui";

import type { ReactNode } from "react";
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
  useRouteLoaderData,
} from "react-router";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunction,
} from "react-router";
import { FirebaseConfigContext } from "./features/notifications/firebase-config-context";
import { type SupportedLng, supportedLngs } from "./i18n";
import { i18nextServer } from "./i18n.server";

import appStylesHref from "./app.css?url";

/**
 * Locale/theme only change via dedicated cookie APIs. Skip revalidating root
 * on every in-app GET so leaf navigations aren't blocked by an extra loader.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formAction,
  formMethod,
  defaultShouldRevalidate,
}) => {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  if (formAction === "/api/set-ui-lang" || formAction === "/api/set-content-lang") {
    return defaultShouldRevalidate;
  }
  return false;
};

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

  return { locale, origin, firebaseConfig };
}

export const meta: MetaFunction<typeof loader> = () => [
  { property: "og:site_name", content: "GDG Japan Wiki" },
];

const fallbackLocale: SupportedLng = "ja";

function useDocumentLocale(): SupportedLng {
  const rootData = useRouteLoaderData("root") as { locale?: unknown } | undefined;
  const { i18n } = useTranslation();
  const loaderLocale = rootData?.locale;
  if (
    typeof loaderLocale === "string" &&
    (supportedLngs as readonly string[]).includes(loaderLocale)
  ) {
    return loaderLocale as SupportedLng;
  }
  if ((supportedLngs as readonly string[]).includes(i18n.resolvedLanguage ?? "")) {
    return i18n.resolvedLanguage as SupportedLng;
  }
  if ((supportedLngs as readonly string[]).includes(i18n.language ?? "")) {
    return i18n.language as SupportedLng;
  }
  return fallbackLocale;
}

/** The document is shared by normal routes and route error boundaries. */
export function Layout({ children }: { children: ReactNode }) {
  const locale = useDocumentLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-K7FMPPSCPY" />
        <script src="/gtag-init.js" />
        <Meta />
        <Links />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        <ThemeProvider storageKey="gdg-apps-theme" defaultTheme="system">
          {children}
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const is404 = status === 404;
  const iconName = is404 ? "AlertTriangle" : "ServerCrash";
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
      <Icons name={iconName} className="w-16 h-16 text-link" strokeWidth={1.5} />
      <div className="text-center space-y-2">
        <p className="text-8xl font-bold text-muted/70">{status}</p>
        <h1 className="text-2xl font-semibold">
          {is404 ? t("error.404_title") : t("error.500_title")}
        </h1>
        <p className="text-muted max-w-sm">{is404 ? t("error.404_desc") : t("error.500_desc")}</p>
      </div>
      <Button asChild className="mt-2">
        <a href="/">{t("error.back_home")}</a>
      </Button>
    </div>
  );
}

export default function App() {
  const { firebaseConfig } = useLoaderData<typeof loader>();

  return (
    <>
      <FirebaseConfigContext value={firebaseConfig}>
        <Outlet />
      </FirebaseConfigContext>
      <Toaster position="top-center" richColors />
    </>
  );
}
