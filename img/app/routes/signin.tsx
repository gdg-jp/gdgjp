import { SSO_PROVIDER_ID, authClient } from "@gdgjp/gdg-lib";
import { useCallback, useEffect, useState } from "react";
import { redirect, useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { safeReturnTo } from "~/lib/return-to";
import type { Route } from "./+types/signin";

export function meta() {
  return [{ title: "Sign in — GDG Japan Image" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if ((context.cloudflare.env.USE_OIDC_CLIENT as string) === "true") {
    const url = new URL(request.url);
    const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/";
    return redirect(`/api/auth/signin?return_to=${encodeURIComponent(returnTo)}`);
  }
  return null;
}

export default function SignInPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("return_to")) ?? "/";
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    setError(null);
    authClient.signIn.oauth2({ providerId: SSO_PROVIDER_ID, callbackURL: returnTo }).catch((e) => {
      console.error("signin.oauth2 failed", e);
      setError(e instanceof Error ? e.message : "Failed to start sign-in. Please try again.");
    });
  }, [returnTo]);

  useEffect(() => {
    start();
  }, [start]);

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button onClick={start}>Retry</Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
      )}
    </div>
  );
}
