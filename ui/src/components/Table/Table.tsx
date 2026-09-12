import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Table({
  className,
  scrollLabel = "表を横にスクロール",
  ...props
}: ComponentProps<"table"> & { scrollLabel?: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: overflow region must support keyboard scrolling.
    <section aria-label={scrollLabel} tabIndex={0} className="gdg-table-scroll">
      <table {...props} className={cn("gdg-table", className)} />
    </section>
  );
}
