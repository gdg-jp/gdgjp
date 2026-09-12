import { createContext, useContext } from "react";
export const FieldContext = createContext(null);
export function useField(props) {
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
