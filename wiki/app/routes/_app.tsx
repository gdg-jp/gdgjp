import { and, eq, isNull, sql } from "drizzle-orm";
import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Await,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
  useRevalidator,
} from "react-router";
import type { LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router";
import Footer from "~/components/Footer";
import Navbar from "~/components/Navbar";
import NavigationProgress from "~/components/NavigationProgress";
import Sidebar from "~/components/Sidebar";
import SidebarDialog from "~/components/SidebarDialog";
import SidebarPopover from "~/components/SidebarPopover";
import { ListSkeleton } from "~/components/Skeleton";
import * as schema from "~/db/schema";
import { getAccessIdentity } from "~/features/auth/utils.server";
import GoogleDocumentImportDialog from "~/features/google/components/GoogleDocumentImportDialog";
import ArchivedContent from "~/features/pages/components/ArchivedContent";
import RecentContent from "~/features/pages/components/RecentContent";
import StarredContent from "~/features/pages/components/StarredContent";
import { buildTree } from "~/features/pages/tree";
import { buildVisibilityFilter } from "~/features/pages/visibility.server";
import ZipImportDialog from "~/features/zip-import/components/ZipImportDialog";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { getDb } from "~/lib/db.server";

// ---------------------------------------------------------------------------
// Revalidation
// ---------------------------------------------------------------------------

/**
 * The published page tree is expensive and stable across in-app GET navigations.
 * Keep the cached tree so leaf routes aren't blocked by a full D1 tree scan.
 * Still refresh after mutations and same-URL revalidate() (import polling, etc.).
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  if (currentUrl.href === nextUrl.href) return defaultShouldRevalidate;
  return false;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getAccessIdentity(request, env);
  const { user } = identity;
  const db = getDb(env);

  const visFilter = buildVisibilityFilter(user, identity.chapters);
  // Stream the sidebar tree so the shell + leaf route can commit without waiting on it.
  const pageTree = db
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
    .all()
    .then(buildTree);

  const unreadNotificationCount = user
    ? ((
        await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.notifications)
          .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)))
          .get()
      )?.count ?? 0)
    : 0;

  return { user, pageTree, unreadNotificationCount };
}

// ---------------------------------------------------------------------------
// Layout component
// ---------------------------------------------------------------------------

export default function AppLayout() {
  const { user, pageTree, unreadNotificationCount } = useLoaderData<typeof loader>();
  const params = useParams();
  // Prefer :slug (edit/history/tasks); fall back to leaf of wiki splat path (/wiki/*).
  const currentSlug = params.slug ?? params["*"]?.split("/").filter(Boolean).at(-1);
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const isMobile = useMediaQuery("(max-width: 767px)");

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [googleDocumentImportOpen, setGoogleDocumentImportOpen] = useState(false);
  const [zipImportOpen, setZipImportOpen] = useState(false);
  const importProgressRef = useRef("");

  useEffect(() => {
    const storageKey = "gdg-google-document-import-jobs";
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      const raw = localStorage.getItem(storageKey);
      let parsed: unknown = [];
      try {
        parsed = JSON.parse(raw ?? "[]") as unknown;
      } catch {
        localStorage.removeItem(storageKey);
      }
      const jobs = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];
      if (!jobs.length) return;
      const results = await Promise.all(
        jobs.map(async (jobId) => {
          const response = await fetch(
            `/api/google-documents/import/${encodeURIComponent(jobId)}/status`,
            {
              credentials: "same-origin",
            },
          );
          return response.ok
            ? ((await response.json()) as {
                id: string;
                status: string;
                completedNodes: number;
                completedImages: number;
              })
            : null;
        }),
      );
      const active = results.filter(
        (
          value,
        ): value is {
          id: string;
          status: string;
          completedNodes: number;
          completedImages: number;
        } => value !== null && !["completed", "failed"].includes(value.status),
      );
      localStorage.setItem(storageKey, JSON.stringify(active.map((value) => value.id)));
      const progress = JSON.stringify(results);
      if (progress !== importProgressRef.current) {
        importProgressRef.current = progress;
        revalidator.revalidate();
      }
    };
    const start = () => {
      void poll();
      if (!timer) timer = setInterval(() => void poll(), 1500);
    };
    start();
    window.addEventListener("google-document-import-enqueued", start);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("google-document-import-enqueued", start);
    };
  }, [revalidator]);

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

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (!searchParams.has("google_document_import")) return;
    setGoogleDocumentImportOpen(true);
    searchParams.delete("google_document_import");
    const query = searchParams.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

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

  const sidebarProps = {
    currentSlug,
    isAuthenticated: Boolean(user),
    isAdmin: user?.isAdmin,
    isOpen: sidebarOpen,
    isMobile,
    onClose: () => setMobileOpen(false),
    onRecentClick: () => setActivePanel((p) => (p === "recent" ? null : "recent")),
    recentButtonRef,
    onStarredClick: () => setActivePanel((p) => (p === "starred" ? null : "starred")),
    starredButtonRef,
    onArchivedClick: () => setActivePanel((p) => (p === "archived" ? null : "archived")),
    archivedButtonRef,
    onImportZip: () => setZipImportOpen(true),
  } as const;

  return (
    <div className="flex min-h-screen flex-col">
      <NavigationProgress />
      <Navbar
        user={user}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        unreadNotificationCount={unreadNotificationCount}
        onImportZip={() => setZipImportOpen(true)}
      />

      <div className="flex flex-1 pt-14">
        <Suspense
          fallback={
            <Sidebar pages={[]} {...sidebarProps} treeFallback={<ListSkeleton rows={10} />} />
          }
        >
          <Await resolve={pageTree}>{(pages) => <Sidebar pages={pages} {...sidebarProps} />}</Await>
        </Suspense>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
      </div>
      {user && (
        <GoogleDocumentImportDialog
          open={googleDocumentImportOpen}
          onOpenChange={setGoogleDocumentImportOpen}
        />
      )}
      {user && <ZipImportDialog open={zipImportOpen} onOpenChange={setZipImportOpen} />}
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
