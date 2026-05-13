import { SSO_PROVIDER_ID, authClient } from "@gdgjp/gdg-lib";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { safeReturnTo } from "~/lib/return-to";

export function meta() {
  return [{ title: "Sign in — GDG Japan Meeting" }];
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
