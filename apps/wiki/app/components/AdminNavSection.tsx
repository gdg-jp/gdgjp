import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import { Icons, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@gdgjp/design-system";
interface AdminNavSectionProps {
  isCollapsed: boolean;
}

// Direct link to /admin/pages, not /admin — /admin/index.tsx server-redirects,
// which would cost a round trip on every click from the normal sidebar.
const ADMIN_CHILDREN = [
  { to: "/admin/pages", labelKey: "admin.nav.pages", icon: "FileText" },
  { to: "/admin/tags", labelKey: "admin.nav.tags", icon: "Tag" },
] as const;

/**
 * Admin entry in the shared sidebar. Shows only the "Admin" parent while
 * outside `/admin`; expands the child links once the user is on an admin
 * screen (and the sidebar isn't collapsed).
 */
export default function AdminNavSection({ isCollapsed }: AdminNavSectionProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const inAdmin = location.pathname.startsWith("/admin");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={inAdmin}>
        <Link
          to="/admin/pages"
          prefetch="intent"
          title={isCollapsed ? t("admin.label") : undefined}
          aria-current={inAdmin ? "page" : undefined}
        >
          <Icons name="Settings" size={16} aria-hidden="true" />
          {!isCollapsed && <span className="truncate">{t("admin.label")}</span>}
        </Link>
      </SidebarMenuButton>
      {inAdmin && !isCollapsed && (
        <SidebarMenu className="ml-4 border-l border-border pl-2">
          {ADMIN_CHILDREN.map(({ to, labelKey, icon }) => {
            const isActive = location.pathname.startsWith(to);
            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link to={to} prefetch="intent" aria-current={isActive ? "page" : undefined}>
                    <Icons name={icon} size={16} aria-hidden="true" />
                    <span className="truncate">{t(labelKey)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </SidebarMenuItem>
  );
}
