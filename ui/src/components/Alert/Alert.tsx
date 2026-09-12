import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../utils";
import type { Tone } from "../Badge";

export function Alert({
  tone = "info",
  title,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { tone?: Tone; title: ReactNode }) {
  const Icon =
    tone === "danger"
      ? CircleAlert
      : tone === "warning"
        ? TriangleAlert
        : tone === "success"
          ? CircleCheck
          : Info;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      {...props}
      className={cn("gdg-alert", `gdg-tone-${tone}`, className)}
    >
      <Icon size={20} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
