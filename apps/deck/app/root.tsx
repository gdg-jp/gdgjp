import { ThemeProvider, Toaster, TooltipProvider } from "@gdgjp/design-system";
import { installSignedOutReload } from "@gdgjp/gdg-lib/auth/signed-out-reload";
import { type ReactNode, useEffect } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/icon-192.png" },
  { rel: "stylesheet", href: stylesheet },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="ja"
      className="dark"
      // next-themes sets an inline color-scheme before hydration.
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#1E1E1E" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // Leave a page whose accounts.gdgs.jp session ended (see gdg-lib).
  useEffect(() => installSignedOutReload(), []);
  return (
    <ThemeProvider forcedTheme="dark" defaultTheme="dark" storageKey="deck-theme">
      <TooltipProvider delayDuration={300}>
        <Outlet />
      </TooltipProvider>
      <Toaster position="top-center" />
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <main className="dk-error">
      <p>{status === 404 ? "デッキが見つかりません" : status}</p>
      <a href="/">deck.gdgs.jp</a>
    </main>
  );
}
