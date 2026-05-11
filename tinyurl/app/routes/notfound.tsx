import { Link } from "react-router";
import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "Not found — GDG Japan Links" }];
}

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 text-center">
      <p className="text-muted-foreground text-sm font-mono">404</p>
      <h1 className="text-2xl font-medium tracking-tight">Link not found</h1>
      <p className="text-muted-foreground text-sm max-w-xs">
        This short link doesn't exist or has been removed.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/links" prefetch="intent">
          Go to links
        </Link>
      </Button>
    </div>
  );
}
