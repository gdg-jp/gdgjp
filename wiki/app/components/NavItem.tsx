import { Link } from "react-router";

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isCollapsed: boolean;
  isActive: boolean;
}

/**
 * Canonical sidebar nav link — `prefetch="intent"`, collapse-aware. Shared by
 * `Sidebar` and `AdminNavSection`; lives in its own module so those two don't
 * form an import cycle through it.
 */
export function NavItem({ to, icon, label, isCollapsed, isActive }: NavItemProps) {
  return (
    <Link
      to={to}
      prefetch="intent"
      title={isCollapsed ? label : undefined}
      className={`flex min-h-8 items-center gap-2 rounded px-2 py-1.5 text-sm ${
        isActive
          ? "bg-surface-selected font-medium text-action-primary"
          : "text-content-secondary hover:bg-surface-sunken"
      }`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!isCollapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
