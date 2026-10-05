import { Outlet } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "~/features/auth/utils.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

// The shared app shell (Navbar + Sidebar) comes from `routes/_app.tsx`, which
// only authenticates. Admin gating lives here so `_app.tsx` stays open to
// every signed-in user. Do not drop this loader.
export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireAdmin(request, context.cloudflare.env);
  return null;
}

// ---------------------------------------------------------------------------
// Layout component
// ---------------------------------------------------------------------------

export default function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-5xl p-6 md:p-8">
      <Outlet />
    </div>
  );
}
