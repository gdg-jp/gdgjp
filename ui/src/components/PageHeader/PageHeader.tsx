import type { ReactNode } from "react";
import { Heading } from "../Heading";

export function PageHeader({
  title,
  description,
  actions,
}: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="gdg-page-header">
      <div>
        <Heading level={1}>{title}</Heading>
        {description && <p className="gdg-muted">{description}</p>}
      </div>
      {actions && <div className="gdg-inline">{actions}</div>}
    </header>
  );
}
