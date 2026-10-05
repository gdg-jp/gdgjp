import { Button } from "@gdgjp/design-system";

export function ShareUrl({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-surface/30 px-3 py-2 text-xs">
      <span className="text-muted">Share:</span>
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
