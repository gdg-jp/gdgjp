import type { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import { PublicShell } from "~/components/PublicShell";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "stylesheet", href: stylesheet },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
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
      ? "URLが正しいか確認してください。"
      : status === 403
        ? "このイベントを管理する権限がありません。"
        : "時間をおいて、もう一度お試しください。";

  return (
    <PublicShell>
      <section className="space-y-3 rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-sm font-semibold text-muted">{status}</p>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted">{message}</p>
        <a
          href="/"
          className="inline-block rounded-md bg-gdg-blue px-4 py-2 font-semibold text-primary-foreground"
        >
          イベント一覧へ
        </a>
      </section>
    </PublicShell>
  );
}
