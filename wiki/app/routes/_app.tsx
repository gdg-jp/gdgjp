import { and, eq, isNull, sql } from "drizzle-orm";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLoaderData, useLocation, useParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import ArchivedContent from "~/components/ArchivedContent";
import Footer from "~/components/Footer";
import Navbar from "~/components/Navbar";
import RecentContent from "~/components/RecentContent";
import Sidebar from "~/components/Sidebar";
import SidebarDialog from "~/components/SidebarDialog";
import SidebarPopover from "~/components/SidebarPopover";
import StarredContent from "~/components/StarredContent";
import * as schema from "~/db/schema";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { getAccessIdentity } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { buildTree } from "~/lib/page-tree";
import { buildVisibilityFilter } from "~/lib/page-visibility.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getAccessIdentity(request, env);
  const { user } = identity;
  const db = getDb(env);

  const visFilter = buildVisibilityFilter(user, identity.chapterIds);
  const treeRows = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      parentId: schema.pages.parentId,
      pageType: schema.pages.pageType,
      sortOrder: schema.pages.sortOrder,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.status, "published"), visFilter))
    .orderBy(schema.pages.sortOrder)
    .all();

  const unreadNotificationCount = user
    ? ((
        await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.notifications)
          .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)))
          .get()
      )?.count ?? 0)
    : 0;

  return { user, pageTree: buildTree(treeRows), unreadNotificationCount };
}

// ---------------------------------------------------------------------------
// Layout component
// ---------------------------------------------------------------------------

export default function AppLayout() {
  const { user, pageTree, unreadNotificationCount } = useLoaderData<typeof loader>();
  const { slug } = useParams();
  const { i18n } = useTranslation();
  const location = useLocation();

  const isMobile = useMediaQuery("(max-width: 767px)");

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Popover/dialog state — only one can be open at a time
  const [activePanel, setActivePanel] = useState<"recent" | "starred" | "archived" | null>(null);
  const recentButtonRef = useRef<HTMLButtonElement>(null);
  const starredButtonRef = useRef<HTMLButtonElement>(null);
  const archivedButtonRef = useRef<HTMLButtonElement>(null);

  const lang: "ja" | "en" = i18n.language === "en" ? "en" : "ja";

  // Restore desktop sidebar state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("gdg-sidebar-open");
      if (stored !== null) setDesktopOpen(stored === "true");
    } catch {
      // ignore – localStorage unavailable
    }
  }, []);

  // Close mobile drawer and all panels on route change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on pathname change
  useEffect(() => {
    setMobileOpen(false);
    setActivePanel(null);
  }, [location.pathname]);

  // Close panels when switching between mobile/desktop to avoid glitches
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on isMobile change
  useEffect(() => {
    setActivePanel(null);
  }, [isMobile]);

  function toggleSidebar() {
    if (isMobile) {
      setMobileOpen((v) => !v);
    } else {
      setDesktopOpen((v) => {
        const next = !v;
        try {
          localStorage.setItem("gdg-sidebar-open", String(next));
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
      <Navbar
        user={user}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        unreadNotificationCount={unreadNotificationCount}
      />

      <div className="flex flex-1 pt-14">
        <Sidebar
          pages={pageTree}
          currentSlug={slug}
          isAuthenticated={Boolean(user)}
          isAdmin={user?.isAdmin}
          isOpen={sidebarOpen}
          isMobile={isMobile}
          onClose={() => setMobileOpen(false)}
          onRecentClick={() => setActivePanel((p) => (p === "recent" ? null : "recent"))}
          recentButtonRef={recentButtonRef}
          onStarredClick={() => setActivePanel((p) => (p === "starred" ? null : "starred"))}
          starredButtonRef={starredButtonRef}
          onArchivedClick={() => setActivePanel((p) => (p === "archived" ? null : "archived"))}
          archivedButtonRef={archivedButtonRef}
        />

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
      </div>
      {/* Signed-in only panels */}
      {user &&
        (isMobile ? (
          <SidebarDialog open={activePanel === "recent"} onClose={() => setActivePanel(null)}>
            <RecentContent
              open={activePanel === "recent"}
              onClose={() => setActivePanel(null)}
              lang={lang}
            />
          </SidebarDialog>
        ) : (
          <SidebarPopover
            open={activePanel === "recent"}
            onClose={() => setActivePanel(null)}
            anchorRef={recentButtonRef}
          >
            <RecentContent
              open={activePanel === "recent"}
              onClose={() => setActivePanel(null)}
              lang={lang}
            />
          </SidebarPopover>
        ))}
      {/* Starred panel */}
      {user &&
        (isMobile ? (
          <SidebarDialog open={activePanel === "starred"} onClose={() => setActivePanel(null)}>
            <StarredContent
              open={activePanel === "starred"}
              onClose={() => setActivePanel(null)}
              lang={lang}
            />
          </SidebarDialog>
        ) : (
          <SidebarPopover
            open={activePanel === "starred"}
            onClose={() => setActivePanel(null)}
            anchorRef={starredButtonRef}
          >
            <StarredContent
              open={activePanel === "starred"}
              onClose={() => setActivePanel(null)}
              lang={lang}
            />
          </SidebarPopover>
        ))}
      {/* Archived panel */}
      {user &&
        (isMobile ? (
          <SidebarDialog open={activePanel === "archived"} onClose={() => setActivePanel(null)}>
            <ArchivedContent
              open={activePanel === "archived"}
              onClose={() => setActivePanel(null)}
              lang={lang}
            />
          </SidebarDialog>
        ) : (
          <SidebarPopover
            open={activePanel === "archived"}
            onClose={() => setActivePanel(null)}
            anchorRef={archivedButtonRef}
          >
            <ArchivedContent
              open={activePanel === "archived"}
              onClose={() => setActivePanel(null)}
              lang={lang}
            />
          </SidebarPopover>
        ))}
    </div>
  );
}
