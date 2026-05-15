import { Archive, Building2, ChevronRight, Clock, Home, Settings, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import BaseSidebar from "~/components/BaseSidebar";
import PageTree from "~/components/PageTree";
import type { PageNode } from "~/lib/page-tree";

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isCollapsed: boolean;
  isActive: boolean;
}

export function NavItem({ to, icon, label, isCollapsed, isActive }: NavItemProps) {
  return (
    <Link
      to={to}
      title={isCollapsed ? label : undefined}
      className={`flex min-h-8 items-center gap-2 rounded px-2 py-1.5 text-sm ${
        isActive ? "bg-blue-500/10 font-medium text-blue-500" : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!isCollapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

interface SidebarProps {
  pages: PageNode[];
  currentSlug?: string;
  userRole?: string;
  isOpen?: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  onRecentClick?: () => void;
  recentButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onStarredClick?: () => void;
  starredButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onArchivedClick?: () => void;
  archivedButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export default function Sidebar({
  pages,
  currentSlug,
  userRole,
  isOpen = true,
  isMobile = false,
  onClose,
  onRecentClick,
  recentButtonRef,
  onStarredClick,
  starredButtonRef,
  onArchivedClick,
  archivedButtonRef,
}: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <BaseSidebar
      storageKey="gdgoc-sidebar-width"
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
            {onRecentClick ? (
              <button
                ref={recentButtonRef}
                type="button"
                title={isCollapsed ? t("nav.recent") : undefined}
                onClick={onRecentClick}
                className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                <span className="flex-shrink-0">
                  <Clock size={16} />
                </span>
                {!isCollapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{t("nav.recent")}</span>
                    <ChevronRight size={14} className="shrink-0 text-gray-400" />
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
            )}
            {onStarredClick ? (
              <button
                ref={starredButtonRef}
                type="button"
                title={isCollapsed ? t("nav.starred") : undefined}
                onClick={onStarredClick}
                className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              >
                <span className="flex-shrink-0">
                  <Star size={16} />
                </span>
                {!isCollapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{t("nav.starred")}</span>
                    <ChevronRight size={14} className="shrink-0 text-gray-400" />
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
            )}
            {userRole &&
              !["viewer", "pending"].includes(userRole) &&
              (onArchivedClick ? (
                <button
                  ref={archivedButtonRef}
                  type="button"
                  title={isCollapsed ? t("nav.archived") : undefined}
                  onClick={onArchivedClick}
                  className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <span className="flex-shrink-0">
                    <Archive size={16} />
                  </span>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{t("nav.archived")}</span>
                      <ChevronRight size={14} className="shrink-0 text-gray-400" />
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
            {["lead", "admin"].includes(userRole ?? "") && (
              <NavItem
                to="/chapter"
                icon={<Building2 size={16} />}
                label={t("nav.chapter")}
                isCollapsed={isCollapsed}
                isActive={location.pathname === "/chapter"}
              />
            )}
            {userRole === "admin" && (
              <NavItem
                to="/admin"
                icon={<Settings size={16} />}
                label={t("nav.admin")}
                isCollapsed={isCollapsed}
                isActive={location.pathname.startsWith("/admin")}
              />
            )}
          </nav>

          {/* Divider */}
          <div className="mx-2 my-1 border-t border-gray-100" />

          {/* Page tree */}
          <div className="min-h-0 flex-1">
            <PageTree
              pages={pages}
              currentSlug={currentSlug}
              isCollapsed={isCollapsed}
              canReorder={
                !isMobile && !isCollapsed && ["member", "lead", "admin"].includes(userRole ?? "")
              }
            />
          </div>
        </div>
      )}
    </BaseSidebar>
  );
}
