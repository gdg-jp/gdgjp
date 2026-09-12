import type { ComponentProps, ReactNode } from "react";

export function Breadcrumb({
  children,
  ...props
}: ComponentProps<"nav"> & { children?: ReactNode }) {
  return (
    <nav aria-label="パンくず" {...props}>
      <ol className="gdg-breadcrumb">{children}</ol>
    </nav>
  );
}
