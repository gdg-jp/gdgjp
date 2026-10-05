import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Icons,
  ThemeToggle,
} from "@gdgjp/design-system";
import { GDG_APP_LINKS } from "@gdgjp/gdg-lib/ui/app-links";
import { Link } from "react-router";
import { GdgMark } from "~/components/gdg-mark";

export type HeaderUser = { name: string; email: string; image: string | null };

export function Header({ user }: { user: HeaderUser | null }) {
  return (
    <header className="sticky top-0 z-30 bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <GdgMark size="sm" />
          <span className="text-lg font-semibold tracking-tight">Scheduler</span>
        </Link>
        <nav aria-label="Scheduler" className="flex flex-wrap items-center gap-2 text-sm">
          <ThemeToggle aria-label="Theme" />
          {user ? (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/events">My events</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton variant="ghost" aria-label="Open app launcher">
                    <Icons name="LayoutGrid" size={20} />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {GDG_APP_LINKS.map((app) => (
                    <DropdownMenuItem key={app.url} asChild>
                      <a href={app.url} target="_blank" rel="noreferrer">
                        <img src={app.iconUrl} alt="" width={24} height={24} />
                        {app.label}
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton variant="ghost" aria-label="Account menu">
                    <Avatar
                      className="size-6 shrink-0"
                      src={user.image ?? undefined}
                      alt={user.name || user.email}
                      fallback={(user.name || user.email).slice(0, 1).toUpperCase()}
                    />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                  <DropdownMenuLabel>
                    <span className="block truncate">{user.name || user.email}</span>
                    <span className="block truncate text-xs text-muted">{user.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href="https://accounts.gdgs.jp/dashboard">
                      <Icons name="Settings" size={16} />
                      Manage your account
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => window.location.assign("/auth/signout")}>
                    <Icons name="Logout" size={16} />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/signin">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
