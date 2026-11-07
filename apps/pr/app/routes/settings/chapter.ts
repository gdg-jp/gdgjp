import { redirect } from "react-router";

/** Old chapter settings page: merged into /settings. */
export function loader() {
  return redirect("/settings");
}
