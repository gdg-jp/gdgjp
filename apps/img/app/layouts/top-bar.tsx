import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Icons,
  Inline,
  ThemeToggle,
} from "@gdgjp/design-system";
import { GDG_APP_LINKS } from "@gdgjp/gdg-lib/ui/app-links";
import { Link } from "react-router";

export type TopBarUser = { email: string; image: string | null; name: string };

export function TopBar({ user }: { user: TopBarUser | null }) {
  const title = user?.name || user?.email || "Account";
  const initials = title
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link to="/" viewTransition className="flex min-w-0 items-center gap-2 font-medium">
          <img
            src="/app-icon.png"
            alt=""
            width={28}
            height={28}
            className="size-7 object-contain"
          />
          <span>GDG Japan Image</span>
        </Link>
        <Inline className="gap-2">
          <ThemeToggle aria-label="Color theme" />
          {user ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton variant="ghost" aria-label="Open app launcher">
                    <Icons name="LayoutGrid" size={20} aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
                  {GDG_APP_LINKS.map((app) => (
                    <DropdownMenuItem key={app.url} asChild>
                      <a href={app.url} target="_blank" rel="noreferrer">
                        <img
                          src={app.iconUrl}
                          alt=""
                          width={24}
                          height={24}
                          className="size-6 object-contain"
                        />
                        {app.label}
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton variant="ghost" aria-label="Account menu" title={title}>
                    <Avatar
                      src={user.image ?? undefined}
                      alt={title}
                      fallback={initials}
                      className="size-7"
                    />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                  <DropdownMenuLabel>
                    <span className="block truncate">{title}</span>
                    <span className="block truncate text-xs text-muted">{user.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href="https://accounts.gdgs.jp/dashboard">Manage your account</a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href="/auth/signout">Sign out</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </Inline>
      </div>
    </header>
  );
}
