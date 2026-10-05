import { Badge } from "@gdgjp/design-system";
import type { ReactNode } from "react";
export type Status = "pending" | "active" | "organizer" | "member" | "rejected";

const TONES = {
  pending: "warning",
  active: "success",
  member: "success",
  organizer: "info",
  rejected: "danger",
} as const;

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: Status;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge tone={TONES[status]} className={className}>
      {children}
    </Badge>
  );
}
