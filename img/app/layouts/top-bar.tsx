import { GdgAccountMenu, GdgAppLauncher, GdgThemeToggle } from "@gdgjp/gdg-lib/ui";
import { Link } from "react-router";

export type TopBarUser = {
  email: string;
  image: string | null;
  name: string;
};

export function TopBar({ user }: { user: TopBarUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur transition-[background-color,border-color,box-shadow] duration-300 supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/" viewTransition className="group flex items-center gap-2">
          <img
            src="/app-icon.png"
            alt=""
            width={1254}
            height={1254}
            className="size-7 object-contain transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-110"
          />
          <span className="font-medium tracking-tight">GDG Japan Image</span>
        </Link>
        <div className="flex items-center gap-2">
          <GdgThemeToggle />
          {user ? (
            <>
              <GdgAppLauncher />
              <GdgAccountMenu
                accountUrl="https://accounts.gdgs.jp/dashboard"
                onSignOut={() => window.location.assign("/auth/signout")}
                user={user}
              />
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
