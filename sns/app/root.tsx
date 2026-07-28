import { ThemeProvider, legacyThemeMigrationScript, themeInitScript } from "@gdgjp/gdg-lib/ui";
import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export const links = () => [
  { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
  { rel: "apple-touch-icon", href: "/app-icon.png" },
  { rel: "stylesheet", href: stylesheet },
];

export const meta: Route.MetaFunction = () => [{ title: "SNS Manager" }];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: migrate the SNS-specific theme preference before bootstrapping */}
        <script dangerouslySetInnerHTML={{ __html: legacyThemeMigrationScript("sns-theme") }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: fixed local pre-paint theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
  return (
    <ThemeProvider>
      <Outlet />
    </ThemeProvider>
  );
}
