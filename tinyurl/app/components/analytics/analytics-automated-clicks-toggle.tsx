import { Label } from "~/components/ui/label";

type Props = {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** Keeps crawler and OGP preview activity out of analytics unless explicitly requested. */
export function AnalyticsAutomatedClicksToggle({ checked, disabled, onCheckedChange }: Props) {
  return (
    <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="size-4 rounded border-input accent-primary"
      />
      Include bot and OGP clicks
    </Label>
  );
}
