import { Button, Heading, Icons, Stack, Text } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import {
  Link,
  type LoaderFunctionArgs,
  type MetaFunction,
  isRouteErrorResponse,
  redirect,
  useRouteError,
} from "react-router";
import { wikiPagePath } from "~/features/pages/wiki-page-path";

export const meta: MetaFunction = () => [{ title: "ページが見つかりません — GDG Japan Wiki" }];

export function loader({ request, params }: LoaderFunctionArgs) {
  const segments = (params["*"] ?? "").split("/").filter(Boolean);

  const url = new URL(request.url);
  if (segments[0] === "s" && segments.length === 3) {
    const [, space, screen] = segments;
    if (screen === "settings") throw redirect(`/spaces/${encodeURIComponent(space)}/settings`, 301);
    if (["recent", "starred", "archived"].includes(screen)) throw redirect(`/${screen}`, 301);
  }
  if (segments[0] === "s" && segments[2] === "admin") {
    throw redirect(`/${segments.slice(2).join("/")}${url.search}`, 301);
  }
  const legacy = segments.length > 0 && !["s", "api", "assets", "og"].includes(segments[0]);
  if (legacy) {
    throw redirect(wikiPagePath(segments) + url.search, 301);
  }

  throw new Response("Not found", { status: 404 });
}

export default function NotFound() {
  return null;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral px-4">
      <Stack align="center" className="max-w-md text-center">
        <Icons name="FileQuestion" className="h-16 w-16 text-link" strokeWidth={1.5} />
        <div className="space-y-2">
          <Text className="text-8xl font-bold text-muted/70">{status}</Text>
          <Heading level={1}>{t("error.404_title")}</Heading>
          <Text tone="muted">{t("error.404_desc")}</Text>
        </div>
        <Button asChild>
          <Link to="/">{t("error.back_home")}</Link>
        </Button>
      </Stack>
    </main>
  );
}
