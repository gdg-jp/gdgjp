import type { ReactNode } from "react";
import { Heading } from "../Heading";

export function EmptyState({
  title,
  description,
  action,
}: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="gdg-empty">
      <Heading level={2}>{title}</Heading>
      {description && <p className="gdg-muted">{description}</p>}
      {action}
    </div>
  );
}
