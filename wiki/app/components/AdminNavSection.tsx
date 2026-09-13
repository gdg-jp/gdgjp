import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { NavItem } from "~/components/NavItem";

import { Icons } from "@gdgjp/ui";
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
    <>
      <NavItem
        to="/admin/pages"
        icon={<Icons name="Settings" size={16} />}
        label={t("admin.label")}
        isCollapsed={isCollapsed}
        isActive={inAdmin}
      />
      {inAdmin && !isCollapsed && (
        <div className="ml-4 space-y-0.5 border-l border-border pl-2">
          {ADMIN_CHILDREN.map(({ to, labelKey, icon }) => (
            <NavItem
              key={to}
              to={to}
              icon={<Icons name={icon} size={16} />}
              label={t(labelKey)}
              isCollapsed={isCollapsed}
              isActive={location.pathname.startsWith(to)}
            />
          ))}
        </div>
      )}
    </>
  );
}
