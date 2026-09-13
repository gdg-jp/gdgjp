import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import AdminNavSection from "~/components/AdminNavSection";
import BaseSidebar from "~/components/BaseSidebar";
import { NavItem } from "~/components/NavItem";
import PageTree from "~/features/pages/components/PageTree";
import type { PageNode } from "~/features/pages/tree";

import { Icons, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@gdgjp/ui";
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
      isOpen={isOpen}
      isMobile={isMobile}
      onClose={onClose}
      navigationDescription={t("nav.navigation_description")}
    >
      {({ isCollapsed }) => (
        <div className="flex h-full flex-col">
          {/* Nav items */}
          <nav aria-label={t("nav.navigation")} className="px-2 pb-1 pt-3">
            <SidebarMenu>
              <NavItem
                to="/"
                icon={<Icons name="Home" size={16} />}
                label={t("nav.home")}
                isCollapsed={isCollapsed}
                isActive={location.pathname === "/"}
              />
              {isAuthenticated &&
                (onRecentClick ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      ref={recentButtonRef}
                      title={isCollapsed ? t("nav.recent") : undefined}
                      onClick={onRecentClick}
                    >
                      <span className="shrink-0" aria-hidden="true">
                        <Icons name="Clock" size={16} />
                      </span>
                      {!isCollapsed && (
                        <>
                          <span className="flex-1 truncate text-left">{t("nav.recent")}</span>
                          <Icons
                            name="ChevronRight"
                            size={14}
                            className="shrink-0"
                            aria-hidden="true"
                          />
                        </>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  <NavItem
                    to="/recent"
                    icon={<Icons name="Clock" size={16} />}
                    label={t("nav.recent")}
                    isCollapsed={isCollapsed}
                    isActive={location.pathname === "/recent"}
                  />
                ))}
              {isAuthenticated &&
                (onStarredClick ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      ref={starredButtonRef}
                      title={isCollapsed ? t("nav.starred") : undefined}
                      onClick={onStarredClick}
                    >
                      <span className="shrink-0" aria-hidden="true">
                        <Icons name="Star" size={16} />
                      </span>
                      {!isCollapsed && (
                        <>
                          <span className="flex-1 truncate text-left">{t("nav.starred")}</span>
                          <Icons
                            name="ChevronRight"
                            size={14}
                            className="shrink-0"
                            aria-hidden="true"
                          />
                        </>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  <NavItem
                    to="/starred"
                    icon={<Icons name="Star" size={16} />}
                    label={t("nav.starred")}
                    isCollapsed={isCollapsed}
                    isActive={location.pathname === "/starred"}
                  />
                ))}
              {isAuthenticated &&
                (onArchivedClick ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      ref={archivedButtonRef}
                      title={isCollapsed ? t("nav.archived") : undefined}
                      onClick={onArchivedClick}
                    >
                      <span className="shrink-0" aria-hidden="true">
                        <Icons name="Archive" size={16} />
                      </span>
                      {!isCollapsed && (
                        <>
                          <span className="flex-1 truncate text-left">{t("nav.archived")}</span>
                          <Icons
                            name="ChevronRight"
                            size={14}
                            className="shrink-0"
                            aria-hidden="true"
                          />
                        </>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  <NavItem
                    to="/archived"
                    icon={<Icons name="Archive" size={16} />}
                    label={t("nav.archived")}
                    isCollapsed={isCollapsed}
                    isActive={location.pathname === "/archived"}
                  />
                ))}
              {isAuthenticated && isAdmin && <AdminNavSection isCollapsed={isCollapsed} />}
            </SidebarMenu>
          </nav>

          {/* Divider */}
          <div className="mx-2 my-1 border-t border-border" />

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
              className="mt-auto border-t border-border px-2 py-2"
            >
              <SidebarMenu>
                <NavItem
                  to="/sources"
                  icon={<Icons name="FileInput" size={16} />}
                  label={t("nav.sources")}
                  isCollapsed={isCollapsed}
                  isActive={location.pathname.startsWith("/sources")}
                />
              </SidebarMenu>
            </nav>
          )}
        </div>
      )}
    </BaseSidebar>
  );
}
