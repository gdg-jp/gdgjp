import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export function loader(_: LoaderFunctionArgs) {
  return redirect("/admin/users");
}
