import { GdgThemeToggle } from "@gdgjp/gdg-lib/ui";
import { Link } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { UserMenu, type UserMenuUser } from "~/components/user-menu";

export function TopBar({ user }: { user: UserMenuUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/links" className="flex items-center gap-3">
          <GdgMark size="sm" />
          <span className="font-medium tracking-tight">GDG Japan Links</span>
        </Link>
        <div className="flex items-center gap-2">
          <GdgThemeToggle />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
