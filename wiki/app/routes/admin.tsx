import { BarChart3, FileText, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLoaderData, useLocation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import BaseSidebar from "~/components/BaseSidebar";
import Navbar from "~/components/Navbar";
import { NavItem } from "~/components/Sidebar";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { requireAdmin } from "~/lib/auth-utils.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireAdmin(request, env);
  return { user };
}

// ---------------------------------------------------------------------------
// Admin sidebar nav items
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { to: "/admin/pages", labelKey: "admin.nav.pages", icon: FileText },
  { to: "/admin/tags", labelKey: "admin.nav.tags", icon: Tag },
  { to: "/admin/stats", labelKey: "admin.nav.stats", icon: BarChart3 },
] as const;

// ---------------------------------------------------------------------------
// Layout component
// ---------------------------------------------------------------------------

export default function AdminLayout() {
  const { user } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const location = useLocation();

  const isMobile = useMediaQuery("(max-width: 767px)");

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restore desktop sidebar state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("gdgoc-admin-sidebar-open");
      if (stored !== null) setDesktopOpen(stored === "true");
    } catch {
      // ignore – localStorage unavailable
    }
  }, []);

  // Close mobile drawer on route change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on pathname change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  function toggleSidebar() {
    if (isMobile) {
      setMobileOpen((v) => !v);
    } else {
      setDesktopOpen((v) => {
        const next = !v;
        try {
          localStorage.setItem("gdgoc-admin-sidebar-open", String(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
  }

  const sidebarOpen = isMobile ? mobileOpen : desktopOpen;

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar user={user} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />

      <div className="flex flex-1 pt-14">
        <BaseSidebar
          storageKey="gdgoc-admin-sidebar-width"
          isOpen={sidebarOpen}
          isMobile={isMobile}
          onClose={() => setMobileOpen(false)}
        >
          {({ isCollapsed }) => (
            <div className="flex h-full flex-col">
              <nav aria-label="Admin navigation" className="space-y-0.5 px-2 pb-1 pt-3">
                {!isCollapsed && (
                  <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {t("admin.label")}
                  </p>
                )}
                {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
                  <NavItem
                    key={to}
                    to={to}
                    icon={<Icon size={16} />}
                    label={t(labelKey)}
                    isCollapsed={isCollapsed}
                    isActive={location.pathname.startsWith(to)}
                  />
                ))}
              </nav>
            </div>
          )}
        </BaseSidebar>

        {/* Main content */}
        <main className="min-w-0 flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
