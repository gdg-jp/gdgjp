import { Archive, ChevronRight, Clock, FileInput, Home, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import AdminNavSection from "~/components/AdminNavSection";
import BaseSidebar from "~/components/BaseSidebar";
import { NavItem } from "~/components/NavItem";
import PageTree from "~/features/pages/components/PageTree";
import type { PageNode } from "~/features/pages/tree";

interface SidebarProps {
  pages: PageNode[];
  currentSlug?: string;
  isAuthenticated?: boolean;
  isAdmin?: boolean | null;
  isOpen?: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  onRecentClick?: () => void;
  recentButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onStarredClick?: () => void;
  starredButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onArchivedClick?: () => void;
  archivedButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onImportZip?: () => void;
  /** When set, replaces the page tree (used as Suspense fallback). */
  treeFallback?: React.ReactNode;
}

export default function Sidebar({
  pages,
  currentSlug,
  isAuthenticated = true,
  isAdmin = false,
  isOpen = true,
  isMobile = false,
  onClose,
  onRecentClick,
  recentButtonRef,
  onStarredClick,
  starredButtonRef,
  onArchivedClick,
  archivedButtonRef,
  onImportZip,
  treeFallback,
}: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <BaseSidebar
      storageKey="gdg-sidebar-width"
      isOpen={isOpen}
      isMobile={isMobile}
      onClose={onClose}
    >
      {({ isCollapsed }) => (
        <div className="flex h-full flex-col">
          {/* Nav items */}
          <nav aria-label="Main navigation" className="space-y-0.5 px-2 pb-1 pt-3">
            <NavItem
              to="/"
              icon={<Home size={16} />}
              label={t("nav.home")}
              isCollapsed={isCollapsed}
              isActive={location.pathname === "/"}
            />
            {isAuthenticated &&
              (onRecentClick ? (
                <button
                  ref={recentButtonRef}
                  type="button"
                  title={isCollapsed ? t("nav.recent") : undefined}
                  onClick={onRecentClick}
                  className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-content-secondary hover:bg-surface-sunken"
                >
                  <span className="flex-shrink-0">
                    <Clock size={16} />
                  </span>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{t("nav.recent")}</span>
                      <ChevronRight size={14} className="shrink-0 text-content-tertiary" />
                    </>
                  )}
                </button>
              ) : (
                <NavItem
                  to="/recent"
                  icon={<Clock size={16} />}
                  label={t("nav.recent")}
                  isCollapsed={isCollapsed}
                  isActive={location.pathname === "/recent"}
                />
              ))}
            {isAuthenticated &&
              (onStarredClick ? (
                <button
                  ref={starredButtonRef}
                  type="button"
                  title={isCollapsed ? t("nav.starred") : undefined}
                  onClick={onStarredClick}
                  className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-content-secondary hover:bg-surface-sunken"
                >
                  <span className="flex-shrink-0">
                    <Star size={16} />
                  </span>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{t("nav.starred")}</span>
                      <ChevronRight size={14} className="shrink-0 text-content-tertiary" />
                    </>
                  )}
                </button>
              ) : (
                <NavItem
                  to="/starred"
                  icon={<Star size={16} />}
                  label={t("nav.starred")}
                  isCollapsed={isCollapsed}
                  isActive={location.pathname === "/starred"}
                />
              ))}
            {isAuthenticated &&
              (onArchivedClick ? (
                <button
                  ref={archivedButtonRef}
                  type="button"
                  title={isCollapsed ? t("nav.archived") : undefined}
                  onClick={onArchivedClick}
                  className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-content-secondary hover:bg-surface-sunken"
                >
                  <span className="flex-shrink-0">
                    <Archive size={16} />
                  </span>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{t("nav.archived")}</span>
                      <ChevronRight size={14} className="shrink-0 text-content-tertiary" />
                    </>
                  )}
                </button>
              ) : (
                <NavItem
                  to="/archived"
                  icon={<Archive size={16} />}
                  label={t("nav.archived")}
                  isCollapsed={isCollapsed}
                  isActive={location.pathname === "/archived"}
                />
              ))}
            {isAuthenticated && isAdmin && <AdminNavSection isCollapsed={isCollapsed} />}
          </nav>

          {/* Divider */}
          <div className="mx-2 my-1 border-t border-subtle" />

          {/* Page tree */}
          <div className="min-h-0 flex-1">
            {treeFallback ?? (
              <PageTree
                pages={pages}
                currentSlug={currentSlug}
                isCollapsed={isCollapsed}
                canReorder={isAuthenticated && !isMobile && !isCollapsed}
                canCreate={isAuthenticated}
                onImportZip={onImportZip}
              />
            )}
          </div>

          {/* Footer — raw sources live outside the page tree, so they get their own entry.
              Settings stays in the Navbar user menu; duplicating it here would give the
              same destination two competing entry points. */}
          {isAuthenticated && (
            <nav
              aria-label={t("sources.nav_label")}
              className="mt-auto space-y-0.5 border-t border-subtle px-2 py-2"
            >
              <NavItem
                to="/sources"
                icon={<FileInput size={16} />}
                label={t("nav.sources")}
                isCollapsed={isCollapsed}
                isActive={location.pathname.startsWith("/sources")}
              />
            </nav>
          )}
        </div>
      )}
    </BaseSidebar>
  );
}
