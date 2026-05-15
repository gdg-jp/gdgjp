import { eq } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import Navbar from "~/components/Navbar";
import * as schema from "~/db/schema";
import { requireRole } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireRole(request, env, "lead");
  const db = getDb(env);

  let chapter = null;
  if (user.chapterId) {
    chapter = await db
      .select()
      .from(schema.chapters)
      .where(eq(schema.chapters.id, user.chapterId))
      .get();
  }

  return { user, chapter };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const NAV_ITEMS = [{ to: "/manage/members", labelKey: "manage.nav.members" }] as const;

export default function ManageLayout() {
  const { user, chapter } = useLoaderData<typeof loader>();
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar user={user} />

      <div className="flex flex-1 pt-14">
        {/* Sidebar */}
        <aside className="fixed bottom-0 left-0 top-14 w-60 overflow-hidden border-r border-gray-200 bg-white">
          <nav className="p-4">
            {chapter && (
              <p className="mb-1 px-3 text-xs font-semibold text-gray-900 truncate">
                {chapter.nameEn}
              </p>
            )}
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t("manage.label")}
            </p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.map(({ to, labelKey }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      [
                        "block rounded-md px-3 py-2 text-sm font-medium",
                        isActive ? "bg-blue-50 text-blue-600" : "text-gray-700 hover:bg-gray-100",
                      ].join(" ")
                    }
                  >
                    {t(labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Main content */}
        <main className="ml-60 min-w-0 flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
