import { cn } from "../../utils";
import { Button, type ButtonProps } from "../Button";

export function IconButton({
  "aria-label": label,
  className,
  ...props
}: ButtonProps & { "aria-label": string }) {
  return <Button {...props} aria-label={label} className={cn("gdg-icon-button", className)} />;
}
