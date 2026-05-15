import { FileQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";

export function loader() {
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
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gray-50 text-gray-900 px-4">
      <FileQuestion className="w-16 h-16 text-blue-500" strokeWidth={1.5} />
      <div className="text-center space-y-2">
        <p className="text-8xl font-bold text-gray-200">{status}</p>
        <h1 className="text-2xl font-semibold">{t("error.404_title")}</h1>
        <p className="text-gray-500 max-w-sm">{t("error.404_desc")}</p>
      </div>
      <Link
        to="/"
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
      >
        {t("error.back_home")}
      </Link>
    </div>
  );
}
