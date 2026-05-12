import { Link } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { ThemeToggle } from "~/components/theme-toggle";
import { Button } from "~/components/ui/button";

export type HeaderUser = { name: string; email: string };

export function Header({ user }: { user: HeaderUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <GdgMark size="sm" />
          <span className="text-lg font-semibold tracking-tight">Scheduler</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <ThemeToggle />
          {user ? (
            <>
              <Link to="/events" className="px-2 text-muted-foreground hover:text-foreground">
                My events
              </Link>
              <span className="hidden max-w-[10rem] truncate text-muted-foreground sm:inline">
                {user.name || user.email}
              </span>
              <Button variant="ghost" size="sm" asChild>
                <a href="/auth/signout">Sign out</a>
              </Button>
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
