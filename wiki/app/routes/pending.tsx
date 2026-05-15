import { useTranslation } from "react-i18next";
import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authClient } from "~/lib/auth.client";
import { createAuth } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const auth = createAuth(context.cloudflare.env);
  const session = await auth.api.getSession({ headers: request.headers });
  // Only pending/viewer users should see this page; redirect others to home
  if (!session) throw redirect("/login");
  const role = session.user.role;
  if (role !== "pending" && role !== "viewer") throw redirect("/");
  return { role };
}

export default function PendingPage() {
  const { t } = useTranslation();
  const { role } = useLoaderData<typeof loader>();
  const isViewer = role === "viewer";

  async function handleSignOut() {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/login";
        },
      },
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 shadow-sm ring-1 ring-gray-100 text-center">
        <div className="mb-2 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100 text-yellow-600 text-2xl">
            ⚠
          </span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-gray-900">
          {t(isViewer ? "viewer.title" : "pending.title")}
        </h1>
        <p className="mt-3 text-sm text-gray-500">
          {t(isViewer ? "viewer.message" : "pending.message")}
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-6 w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {t("pending.sign_out")}
        </button>
      </div>
    </div>
  );
}
