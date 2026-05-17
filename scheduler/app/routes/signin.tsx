import { redirect } from "react-router";
import { safeReturnTo } from "~/lib/return-to";
import type { Route } from "./+types/signin";

export function meta() {
  return [{ title: "Sign in — GDG Japan Meeting" }];
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/events";
  return redirect(`/api/auth/signin?return_to=${encodeURIComponent(returnTo)}`);
}

export default function SignInPage() {
  return null;
}
