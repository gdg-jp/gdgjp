import { type ComponentProps, type ReactElement, cloneElement, isValidElement } from "react";
import { cn } from "../../utils";

export type MarkerVariant = "default" | "border" | "separator";

export function Marker({
  variant = "default",
  render,
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  variant?: MarkerVariant;
  render?: ReactElement<ComponentProps<"div">>;
}) {
  const classNames = cn("gdg-marker", `gdg-marker-${variant}`, className);
  if (render && isValidElement(render)) {
    return cloneElement(render, {
      ...props,
      className: cn(classNames, render.props.className),
    });
  }
  return (
    <div {...props} className={classNames}>
      {children}
    </div>
  );
}

export function MarkerIcon({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} aria-hidden="true" className={cn("gdg-marker-icon", className)} />;
}

export function MarkerContent({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cn("gdg-marker-content", className)} />;
}
