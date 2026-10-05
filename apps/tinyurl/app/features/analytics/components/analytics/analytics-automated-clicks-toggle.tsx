import { Checkbox, Label } from "@gdgjp/design-system";
type Props = {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** Keeps crawler and OGP preview activity out of analytics unless explicitly requested. */
export function AnalyticsAutomatedClicksToggle({ checked, disabled, onCheckedChange }: Props) {
  return (
    <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-muted">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      Include bot and OGP clicks
    </Label>
  );
}
