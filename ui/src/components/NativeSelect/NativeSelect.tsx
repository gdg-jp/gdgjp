import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";

export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  const field = useField(props);
  return (
    <div className="gdg-native-select-wrap">
      <select {...props} {...field} className={cn("gdg-input", "gdg-native-select", className)}>
        {children}
      </select>
      <ChevronDown className="gdg-native-select-icon" size={16} aria-hidden="true" />
    </div>
  );
}

export function NativeSelectOption({ className, ...props }: ComponentProps<"option">) {
  return <option {...props} className={className} />;
}

export function NativeSelectOptGroup({ className, ...props }: ComponentProps<"optgroup">) {
  return <optgroup {...props} className={className} />;
}
