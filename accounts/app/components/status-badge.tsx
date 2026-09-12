import { Badge, type Tone } from "@gdgjp/ui";
import type { ReactNode } from "react";

export type Status = "pending" | "active" | "organizer" | "member" | "rejected";

const TONES: Record<Status, Tone> = {
  pending: "warning",
  active: "success",
  member: "success",
  organizer: "info",
  rejected: "danger",
};

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
