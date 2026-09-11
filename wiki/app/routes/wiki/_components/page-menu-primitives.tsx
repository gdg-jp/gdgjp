import { DropdownMenu as Primitive } from "radix-ui";
import type { ReactNode } from "react";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export function DropdownMenuPrimitiveSwitch({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Primitive.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => event.preventDefault()}
      className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none focus:bg-surface-hover [&_svg]:size-4 [&_svg]:text-content-tertiary"
    >
      {children}
      <span
        aria-hidden="true"
        className={`ml-auto flex h-5 w-9 items-center rounded-full p-0.5 ${checked ? "bg-action-primary" : "bg-content-disabled"}`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-content-inverse dark:bg-content-primary ${checked ? "translate-x-4" : ""}`}
        />
      </span>
    </Primitive.CheckboxItem>
  );
}
