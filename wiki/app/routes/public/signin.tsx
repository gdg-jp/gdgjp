import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { safeReturnTo } from "~/lib/auth-redirect";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/";
  return redirect(`/api/auth/signin?return_to=${encodeURIComponent(returnTo)}`);
}

export default function SignInPage() {
  // Unreachable: the loader immediately starts the accounts IdP sign-in flow.
  return null;
}
