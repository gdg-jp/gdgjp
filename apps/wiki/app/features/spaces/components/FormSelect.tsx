import {
  FormField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gdgjp/design-system";

/** Labelled select that posts `name` with its form (Radix Select renders a hidden input). */
export function FormSelect({
  name,
  label,
  defaultValue,
  options,
  hideLabel,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  hideLabel?: boolean;
  className?: string;
}) {
  return (
    <FormField label={label} hideLabel={hideLabel} className={className}>
      <Select name={name} defaultValue={defaultValue ?? options[0]?.value}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
