import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { Toaster } from "~/components/ui/sonner";
import { ThemeProvider, themeInitScript } from "~/lib/theme";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

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

export default function App() {
  return (
    <ThemeProvider>
      <Outlet />
      <Toaster richColors />
    </ThemeProvider>
  );
}
