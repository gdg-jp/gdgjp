import { type ComponentProps, createContext, useContext } from "react";

export const FieldContext = createContext<{
  id: string;
  description?: string;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
} | null>(null);

export function useField(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: ComponentProps<"input">["aria-invalid"];
  disabled?: boolean;
  required?: boolean;
}) {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    "aria-describedby":
      [field?.description, props["aria-describedby"]].filter(Boolean).join(" ") || undefined,
    "aria-invalid": props["aria-invalid"] ?? field?.invalid,
    disabled: props.disabled ?? field?.disabled,
    required: props.required ?? field?.required,
  };
}
