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
} from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "stylesheet", href: stylesheet },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeProvider storageKey="gdg-apps-theme" defaultTheme="system">
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // Leave a page whose accounts.gdgs.jp session ended (see gdg-lib).
  useEffect(() => installSignedOutReload(), []);
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const title =
    status === 404
      ? "ページが見つかりません"
      : status === 403
        ? "アクセスできません"
        : "問題が発生しました";
  const message =
    status === 404
      ? "URL が正しいか確認してください。"
      : status === 403
        ? "このプロジェクトを管理する権限がありません。"
        : "時間をおいて、もう一度お試しください。";
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="space-y-3">
        <p className="text-sm font-semibold text-muted">{status}</p>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted">{message}</p>
      </div>
    </main>
  );
}
