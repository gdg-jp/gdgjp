import { redirect } from "react-router";

/** Old "my tasks" page: its items are on the notifications page now. */
export function loader() {
  return redirect("/");
}
