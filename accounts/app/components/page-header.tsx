import { Button, Icons, PageHeader as SharedPageHeader } from "@gdgjp/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";

export type PageHeaderBack = {
  label: string;
  to: string;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  back?: PageHeaderBack;
  className?: string;
}) {
  return (
    <SharedPageHeader
      back={
        back ? (
          <Button asChild variant="ghost" size="sm" className="group -ml-2 text-muted">
            <Link to={back.to} prefetch="intent">
              <Icons name="ArrowLeft" size={16} aria-hidden="true" />
              {back.label}
            </Link>
          </Button>
        ) : undefined
      }
      className={className}
      title={
        <>
          {eyebrow ? <span className="mb-1 block text-sm text-muted">{eyebrow}</span> : null}
          {title}
        </>
      }
      description={description}
      actions={actions}
    />
  );
}
