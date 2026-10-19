import { ThemeProvider, Toaster, TooltipProvider } from "@gdgjp/design-system";
import type { ReactNode } from "react";
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
  // OBS output pages composite over the scene: no background at all.
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
  if (useTransparent()) return <Outlet />;
  return (
    <ThemeProvider forcedTheme="dark" defaultTheme="dark" storageKey="screen-theme">
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
    <main className="screen-error">
      <p>{status}</p>
      <a href="/">screen.gdgs.jp</a>
    </main>
  );
}
