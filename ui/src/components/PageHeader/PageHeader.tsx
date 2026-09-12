import type { ReactNode } from "react";
import { cn } from "../../utils";
import { Heading } from "../Heading";

export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  className?: string;
}) {
  const header = (
    <header className={cn("gdg-page-header", className)}>
      <div>
        <Heading level={1}>{title}</Heading>
        {description && <p className="gdg-muted">{description}</p>}
      </div>
      {actions && <div className="gdg-inline">{actions}</div>}
    </header>
  );
  if (back) {
    return (
      <div className="gdg-page-header-with-back">
        {back}
        {header}
      </div>
    );
  }
  return header;
}
