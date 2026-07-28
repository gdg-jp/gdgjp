import { redirect } from "react-router";
import { safeReturnTo } from "~/lib/access.server";
import type { Route } from "./+types/signin";
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  throw redirect(
    `/api/auth/signin?return_to=${encodeURIComponent(safeReturnTo(url.searchParams.get("return_to")))}`,
  );
}
export default function Signin() {
  return null;
}
