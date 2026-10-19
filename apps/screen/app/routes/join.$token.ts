import { redirect } from "react-router";
import type { Route } from "./+types/join.$token";

/** Invite links used to live under /join/; keep any shared ones working. */
export function loader({ params }: Route.LoaderArgs) {
  return redirect(`/${encodeURIComponent(params.token)}/`, 301);
}
