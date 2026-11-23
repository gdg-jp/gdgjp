import { Outlet } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "~/features/auth/utils.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireAdmin(request, context.cloudflare.env);
  return null;
}

export default function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-5xl p-6 md:p-8">
      <Outlet />
    </div>
  );
}
