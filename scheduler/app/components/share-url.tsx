import { Button } from "./ui/button";

export function ShareUrl({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <span className="text-muted-foreground">Share:</span>
      <code className="truncate">{path}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          if (typeof window !== "undefined") {
            void navigator.clipboard.writeText(window.location.href);
          }
        }}
      >
        Copy
      </Button>
    </div>
  );
}
