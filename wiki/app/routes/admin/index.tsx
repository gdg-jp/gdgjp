import { redirect } from "react-router";

// /admin → /admin/pages. Pre-SSO this rendered a dashboard with user/chapter
// stats; user mgmt moved to accounts, so admins land on page management.
export function loader() {
  throw redirect("/admin/pages");
}
