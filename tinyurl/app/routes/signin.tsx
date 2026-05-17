import { redirect } from "react-router";
import type { Route } from "./+types/signin";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/links";
  return redirect(`/api/auth/signin?return_to=${encodeURIComponent(returnTo)}`);
}

export default function SignInPage() {
  // Unreachable — the loader always redirects.
  return null;
}

function safeReturnTo(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
