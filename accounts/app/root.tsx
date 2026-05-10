import { useEffect } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunction,
} from "react-router";
import { Toaster } from "~/components/ui/sonner";
import { i18n } from "~/lib/i18n/i18n.server";
import { fallbackLng, isLocale } from "~/lib/i18n/resources";
import { ThemeProvider, themeInitScript } from "~/lib/theme";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export const loader = async (args: Route.LoaderArgs) => {
  const locale = await i18n.getLocale(args.request);
  return { locale };
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  formAction,
  defaultShouldRevalidate,
}) => {
  // Locale only changes when the user switches it via the locale switcher,
  // which posts to /api/locale. Skip revalidating on every page navigation.
  if (formAction === "/api/locale") return defaultShouldRevalidate;
  return false;
};

export const handle = { i18n: ["common"] };

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
  { rel: "stylesheet", href: stylesheet },
];

export function Layout({ children }: { children: ReactNode }) {
  const lang = useRootLang();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: pre-paint theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function useRootLang() {
  const { i18n: i18nClient } = useTranslation();
  return i18nClient.resolvedLanguage ?? i18nClient.language ?? fallbackLng;
}

export default function App({ loaderData }: Route.ComponentProps) {
  const { i18n: i18nClient } = useTranslation();
  const locale = isLocale(loaderData.locale) ? loaderData.locale : fallbackLng;
  useEffect(() => {
    if (i18nClient.resolvedLanguage !== locale) {
      void i18nClient.changeLanguage(locale);
    }
  }, [locale, i18nClient]);
  return (
    <ThemeProvider>
      <Outlet />
      <Toaster position="top-center" richColors />
    </ThemeProvider>
  );
}
