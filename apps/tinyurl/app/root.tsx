import { ThemeProvider, Toaster } from "@gdgjp/design-system";
import { installSignedOutReload } from "@gdgjp/gdg-lib/auth/signed-out-reload";
import { type ReactNode, useEffect } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export function loader({ context }: Route.LoaderArgs) {
  return { domainsEnabled: String(context.cloudflare.env.DOMAINS_ENABLED) === "true" };
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/app-icon.png", type: "image/png" },
  { rel: "apple-touch-icon", href: "/app-icon.png" },
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
      <body className="font-sans antialiased">
        <ThemeProvider storageKey="gdg-apps-theme" defaultTheme="system">
          {children}
          <Toaster />
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
