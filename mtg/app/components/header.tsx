import { Link } from "react-router";
import { Button } from "~/components/ui/button";

export type HeaderUser = { name: string; email: string };

export function Header({ user }: { user: HeaderUser | null }) {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          mtg
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          {user ? (
            <>
              <Link to="/events" className="text-muted-foreground hover:text-foreground">
                My events
              </Link>
              <span className="text-muted-foreground">·</span>
              <span className="max-w-[10rem] truncate text-muted-foreground">
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
