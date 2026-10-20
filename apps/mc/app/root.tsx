import { ThemeProvider, Toaster } from "@gdgjp/design-system";
import { installSignedOutReload } from "@gdgjp/gdg-lib/auth/signed-out-reload";
import { type ReactNode, useEffect } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useMatches,
} from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "stylesheet", href: stylesheet },
];

export type RouteHandle = { transparent?: boolean };

function useTransparent(): boolean {
  return useMatches().some((m) => (m.handle as RouteHandle | undefined)?.transparent);
}

export function Layout({ children }: { children: ReactNode }) {
  // The OBS player page must composite over the scene: no background at all.
  const transparent = useTransparent();
  return (
    <html
      lang="ja"
      className="dark"
      data-surface={transparent ? "transparent" : undefined}
      // next-themes sets an inline color-scheme before hydration.
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* A dark color-scheme paints an opaque canvas, which OBS would composite. */}
        {!transparent && <meta name="color-scheme" content="dark" />}
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
  // next-themes writes an inline `color-scheme: dark`, which would paint an
  // opaque canvas behind the OBS player; that page needs no theme anyway.
  if (useTransparent()) return <Outlet />;
  return (
    <ThemeProvider forcedTheme="dark" defaultTheme="dark" storageKey="mc-theme">
      <Outlet />
      <Toaster position="top-center" />
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <main className="mc-error">
      <p>{status}</p>
      <a href="/">mc.gdgs.jp</a>
    </main>
  );
}
