import { FileQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Link,
  type LoaderFunctionArgs,
  isRouteErrorResponse,
  redirect,
  useRouteError,
} from "react-router";
import { wikiPagePath } from "~/features/pages/wiki-page-path";

export function loader({ request, params }: LoaderFunctionArgs) {
  const segments = (params["*"] ?? "").split("/").filter(Boolean);

  if (segments.length > 0) {
    const url = new URL(request.url);
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
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-surface-sunken text-content-primary px-4">
      <FileQuestion className="w-16 h-16 text-action-primary" strokeWidth={1.5} />
      <div className="text-center space-y-2">
        <p className="text-8xl font-bold text-content-disabled">{status}</p>
        <h1 className="text-2xl font-semibold">{t("error.404_title")}</h1>
        <p className="text-content-tertiary max-w-sm">{t("error.404_desc")}</p>
      </div>
      <Link
        to="/"
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-action-primary px-5 py-2.5 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover transition-colors"
      >
        {t("error.back_home")}
      </Link>
    </div>
  );
}
