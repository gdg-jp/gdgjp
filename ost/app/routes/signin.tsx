import { redirect } from "react-router";
import { safeReturnTo } from "~/features/auth/return-to";
import type { Route } from "./+types/signin";

export function meta() {
  return [{ title: "ログイン — OST" }];
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/";
  return redirect(`/api/auth/signin?return_to=${encodeURIComponent(returnTo)}`);
}

export default function SignInPage() {
  // Unreachable — the loader always redirects.
  return null;
}
