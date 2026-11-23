import { SidebarMenuButton, SidebarMenuItem } from "@gdgjp/design-system";
import { Link } from "react-router";

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isCollapsed: boolean;
  isActive: boolean;
}

export function NavItem({ to, icon, label, isCollapsed, isActive }: NavItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <Link
          to={to}
          prefetch="intent"
          title={isCollapsed ? label : undefined}
          aria-current={isActive ? "page" : undefined}
        >
          <span className="shrink-0" aria-hidden="true">
            {icon}
          </span>
          {!isCollapsed && <span className="truncate">{label}</span>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
