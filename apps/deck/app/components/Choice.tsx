import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gdgjp/design-system";

export type ChoiceOption = { value: string; label: string; disabled?: boolean };

/**
 * The design-system Select for a flat list of options. `name` posts the value
 * with a surrounding form (Radix renders a hidden native select for that).
 */
export function Choice({
  value,
  defaultValue,
  onChange,
  options,
  name,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: ChoiceOption[];
  name?: string;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select value={value} defaultValue={defaultValue} onValueChange={onChange} name={name}>
      <SelectTrigger className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
