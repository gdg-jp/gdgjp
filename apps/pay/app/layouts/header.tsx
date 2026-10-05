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
  Inline,
  ThemeToggle,
} from "@gdgjp/design-system";
import { GDG_APP_LINKS } from "@gdgjp/gdg-lib/ui/app-links";
import { Link, useLocation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";

export type HeaderUser = { name: string; email: string; image: string | null };

export function Header({ user }: { user: HeaderUser | null }) {
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-30 bg-surface">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          to="/"
          className="flex items-center gap-2"
          aria-current={pathname === "/" ? "page" : undefined}
        >
          <GdgMark size="sm" />
          <span className="text-lg font-semibold tracking-tight">Pay</span>
        </Link>
        <nav aria-label="Pay ナビゲーション">
          <Inline className="gap-2 text-sm">
            <ThemeToggle className="w-auto" />
            {user ? (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/profile" aria-current={pathname === "/profile" ? "page" : undefined}>
                    口座情報
                  </Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton variant="ghost" aria-label="GDG アプリ">
                      <Icons name="LayoutGrid" size={20} aria-hidden="true" />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>GDG アプリ</DropdownMenuLabel>
                    {GDG_APP_LINKS.map((app) => (
                      <DropdownMenuItem key={app.url} asChild>
                        <a href={app.url}>
                          <img src={app.iconUrl} alt="" width={24} height={24} />
                          {app.label}
                        </a>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton variant="ghost" aria-label="アカウント">
                      <Avatar
                        className="size-6 shrink-0"
                        src={user.image ?? undefined}
                        alt={user.name}
                        fallback={user.name.slice(0, 1)}
                      />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      <span className="block">{user.name}</span>
                      <span className="block break-all text-xs font-normal text-muted">
                        {user.email}
                      </span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a href="https://accounts.gdgs.jp/dashboard">アカウント設定</a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href="/auth/signout">サインアウト</a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/signin">Sign in</Link>
              </Button>
            )}
          </Inline>
        </nav>
      </div>
    </header>
  );
}
