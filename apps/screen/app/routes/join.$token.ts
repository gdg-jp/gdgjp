import { redirect } from "react-router";
import type { Route } from "./+types/join.$token";

export function loader({ params }: Route.LoaderArgs) {
  return redirect(`/${encodeURIComponent(params.token)}/`, 301);
}
