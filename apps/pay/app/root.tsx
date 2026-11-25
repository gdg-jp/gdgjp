import {
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
  ThemeProvider,
  Toaster,
} from "@gdgjp/design-system";
import { useSignedOutReload } from "@gdgjp/gdg-lib/auth/signed-out-reload";
import type { ReactNode } from "react";
import {
  Link,
  Links,
  Meta,
  Outlet,
  type Params,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { FORBIDDEN_REASONS, forbiddenReason } from "~/features/auth/forbidden";

import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export function loader({ context }: Route.LoaderArgs) {
  return { accountsUrl: context.cloudflare.env.ACCOUNTS_URL };
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/app-icon.png", type: "image/png" },
  { rel: "apple-touch-icon", href: "/app-icon.png" },
  { rel: "stylesheet", href: stylesheet },
];

export const meta: Route.MetaFunction = () => [{ property: "og:image", content: "/app-icon.png" }];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider storageKey="gdg-apps-theme" defaultTheme="system">
          {children}
          <Toaster richColors />
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useSignedOutReload();
  return <Outlet />;
}

function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button asChild>
      <Link to={to}>{children}</Link>
    </Button>
  );
}

function errorPage(error: unknown, params: Readonly<Params>, accountsUrl: string | undefined) {
  const reason = forbiddenReason(error);
  const eventPath = params.id ? `/events/${params.id}` : "/";
  switch (reason) {
    case "no-chapter":
      return {
        status: 403,
        ...FORBIDDEN_REASONS[reason],
        actions: (
          <>
            {accountsUrl ? (
              <Button asChild>
                <a href={`${accountsUrl}/onboarding`}>チャプターに参加する</a>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <a href="/auth/signout">別のアカウントでサインイン</a>
            </Button>
          </>
        ),
      };
    case "not-proxy-registrar":
    case "not-claim-viewer":
      return {
        status: 403,
        ...FORBIDDEN_REASONS[reason],
        actions: <BackLink to={eventPath}>イベントに戻る</BackLink>,
      };
    case "not-claim-editor":
      return {
        status: 403,
        ...FORBIDDEN_REASONS[reason],
        actions: (
          <BackLink to={params.claimId ? `${eventPath}/claims/${params.claimId}` : eventPath}>
            申請に戻る
          </BackLink>
        ),
      };
  }
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const home = <BackLink to="/">イベント一覧へ</BackLink>;
  if (status === 403) {
    return {
      status,
      title: "アクセスできません",
      description: "このページを開く権限がありません。",
      actions: home,
    };
  }
  if (status === 404) {
    return {
      status,
      title: "ページが見つかりません",
      description: "URL が正しいか確認してください。イベントや申請が見つかりませんでした。",
      actions: home,
    };
  }
  return {
    status,
    title: "問題が発生しました",
    description: "時間をおいて、もう一度お試しください。",
    actions: home,
  };
}

export function ErrorBoundary({ error, params, loaderData }: Route.ErrorBoundaryProps) {
  const page = errorPage(error, params, loaderData?.accountsUrl);
  return (
    <div className="min-h-dvh bg-background">
      <title>{`${page.title} — GDG Japan Pay`}</title>
      <main className="mx-auto max-w-xl px-4 py-10 sm:py-16">
        <Card>
          <Stack>
            <Link to="/" className="flex w-fit items-center gap-2">
              <GdgMark size="sm" />
              <span className="text-lg font-semibold tracking-tight">Pay</span>
            </Link>
            <Text tone="muted" size="sm">
              エラー {page.status}
            </Text>
            <Heading level={1}>{page.title}</Heading>
            <Text>{page.description}</Text>
            <Inline>{page.actions}</Inline>
          </Stack>
        </Card>
      </main>
    </div>
  );
}
