import { SSO_PROVIDER_ID, authClient } from "@gdgjp/gdg-lib";
import { useEffect } from "react";
import { redirect, useSearchParams } from "react-router";
import { safeReturnTo } from "~/lib/return-to";
import type { Route } from "./+types/signin";

export function meta() {
  return [{ title: "Sign in — GDG Japan Meeting" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if ((context.cloudflare.env.USE_OIDC_CLIENT as string) === "true") {
    const url = new URL(request.url);
    const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/events";
    return redirect(`/api/auth/signin?return_to=${encodeURIComponent(returnTo)}`);
  }
  return null;
}

export default function SignInPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("return_to")) ?? "/events";

  useEffect(() => {
    void authClient.signIn.oauth2({ providerId: SSO_PROVIDER_ID, callbackURL: returnTo });
  }, [returnTo]);

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
    </div>
  );
}
