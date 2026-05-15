import { SSO_PROVIDER_ID } from "@gdgjp/gdg-lib";
import { useTranslation } from "react-i18next";
import { Link, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authClient } from "~/lib/auth.client";
import { createAuth } from "~/lib/auth.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const auth = createAuth(context.cloudflare.env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (session) throw redirect("/");
  return {};
}

export default function LoginPage() {
  const { t } = useTranslation();

  async function handleGoogleSignIn() {
    await authClient.signIn.oauth2({ providerId: SSO_PROVIDER_ID, callbackURL: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 shadow-sm ring-1 ring-gray-100">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">{t("login.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("login.subtitle")}</p>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <GoogleIcon />
          {t("login.google_signin")}
        </button>

        <p className="mt-6 text-center text-xs text-gray-400">{t("login.access_restricted")}</p>

        <div className="mt-4 flex justify-center gap-4 text-xs text-gray-400">
          <Link to="/privacy" className="hover:text-blue-500">
            {t("footer.privacy")}
          </Link>
          <Link to="/terms" className="hover:text-blue-500">
            {t("footer.terms")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
