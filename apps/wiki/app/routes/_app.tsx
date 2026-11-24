import { SidebarProvider } from "@gdgjp/design-system";
import { useClientValue, useMediaQuery } from "@gdgjp/gdg-lib/react";
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
import { agentPagesFilter } from "~/features/pages/page-space.server";
import { buildTree } from "~/features/pages/tree";
import { buildVisibilityFilter } from "~/features/pages/visibility.server";
import { CurrentSpaceProvider } from "~/features/spaces/components/current-space";
import { resolveShellSpaces } from "~/features/spaces/shell.server";
import { loadViewerContext } from "~/features/spaces/viewer.server";
import ZipImportDialog from "~/features/zip-import/components/ZipImportDialog";
import { getDb } from "~/lib/db.server";

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  if (currentUrl.href === nextUrl.href) return defaultShouldRevalidate;
  if (spaceSlugOf(currentUrl.pathname) !== spaceSlugOf(nextUrl.pathname)) return true;
  return false;
}

function spaceSlugOf(pathname: string): string | null {
  const match = /^\/s\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getAccessIdentity(request, env);
  const { user } = identity;
  const db = getDb(env);
  const viewer = await loadViewerContext(request, env, identity);
  const { spaces, currentSpace } = await resolveShellSpaces(db, viewer, params.space);

  const visFilter = buildVisibilityFilter(user, identity.chapters);
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
    .where(
      and(
        eq(schema.pages.status, "published"),
        eq(schema.pages.spaceId, currentSpace.id),
        visFilter,
        agentPagesFilter(viewer.hideAgentPages),
      ),
    )
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

  return {
    user,
    pageTree,
    unreadNotificationCount,
    spaces,
    currentSpace,
    hideAgentPages: viewer.hideAgentPages,
  };
}

function readPersistedSidebarOpen(): boolean | null {
  try {
    const persisted = localStorage.getItem("gdg-sidebar-open");
    return persisted === null ? null : persisted === "true";
  } catch {
    return null;
  }
}

export default function AppLayout() {
  const { user, pageTree, unreadNotificationCount, spaces, currentSpace, hideAgentPages } =
    useLoaderData<typeof loader>();
  const params = useParams();
  const currentSlug = params.slug ?? params["*"]?.split("/").filter(Boolean).at(-1);
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const isMobile = useMediaQuery("(max-width: 767px)");

  const persistedDesktopOpen = useClientValue(readPersistedSidebarOpen, null);
  const [desktopOpenOverride, setDesktopOpenOverride] = useState<boolean | null>(null);
  const desktopOpen = desktopOpenOverride ?? persistedDesktopOpen ?? true;
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

  const [activePanel, setActivePanel] = useState<"recent" | "starred" | "archived" | null>(null);
  const recentButtonRef = useRef<HTMLButtonElement>(null);
  const starredButtonRef = useRef<HTMLButtonElement>(null);
  const archivedButtonRef = useRef<HTMLButtonElement>(null);

  const lang: "ja" | "en" = i18n.language === "en" ? "en" : "ja";

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (!searchParams.has("google_document_import")) return;
    setGoogleDocumentImportOpen(true);
    searchParams.delete("google_document_import");
    const query = searchParams.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const [panelPathname, setPanelPathname] = useState(location.pathname);
  if (panelPathname !== location.pathname) {
    setPanelPathname(location.pathname);
    setMobileOpen(false);
    setActivePanel(null);
  }

  const [panelIsMobile, setPanelIsMobile] = useState(isMobile);
  if (panelIsMobile !== isMobile) {
    setPanelIsMobile(isMobile);
    setActivePanel(null);
  }

  function toggleSidebar() {
    if (isMobile) {
      setMobileOpen((v) => !v);
      return;
    }
    changeDesktopOpen(!desktopOpen);
  }

  function changeDesktopOpen(next: boolean) {
    setDesktopOpenOverride(next);
    try {
      localStorage.setItem("gdg-sidebar-open", String(next));
    } catch {}
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
    spaces,
    hideAgentPages,
  } as const;

  return (
    <CurrentSpaceProvider value={currentSpace}>
      <SidebarProvider open={desktopOpen} onOpenChange={changeDesktopOpen} className="flex-col">
        <a className="gdg-skip-link" href="#wiki-main">
          {t("nav.skip_to_content")}
        </a>
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
            <Await resolve={pageTree} errorElement={<Sidebar pages={[]} {...sidebarProps} />}>
              {(pages) => <Sidebar pages={pages} {...sidebarProps} />}
            </Await>
          </Suspense>

          <div className="flex min-w-0 flex-1 flex-col">
            <main id="wiki-main" tabIndex={-1} className="flex-1">
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
      </SidebarProvider>
    </CurrentSpaceProvider>
  );
}
