import type { ComponentProps } from "react";
import { cn } from "../../utils";
import { Button, type ButtonProps } from "../Button";
import { Input } from "../Input";
import { Textarea } from "../Textarea";

export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div {...props} role={props.role ?? "group"} className={cn("gdg-input-group", className)} />
  );
}

export function InputGroupAddon({
  align = "inline-start",
  className,
  ...props
}: ComponentProps<"div"> & {
  align?: "inline-start" | "inline-end" | "block-start" | "block-end";
}) {
  return <div {...props} data-align={align} className={cn("gdg-input-group-addon", className)} />;
}

export function InputGroupText({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cn("gdg-input-group-text", className)} />;
}

export function InputGroupInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input {...props} className={cn("gdg-input-group-input", className)} />;
}

export function InputGroupTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea {...props} className={cn("gdg-input-group-textarea", className)} />;
}

export function InputGroupButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      size={props.size ?? "sm"}
      variant={props.variant ?? "ghost"}
      className={cn("gdg-input-group-button", className)}
    />
  );
}
