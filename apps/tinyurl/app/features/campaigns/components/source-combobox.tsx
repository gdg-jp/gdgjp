import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  Icons,
} from "@gdgjp/design-system";
import { useState } from "react";
import { SOURCE_CODE_PATTERN } from "~/features/campaigns/components/source-url";
export type SourceOption = { code: string; name: string };
export function SourceCombobox({
  value,
  sources,
  onValueChange,
}: { value: string; sources: SourceOption[]; onValueChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const normalized = value.trim().toLowerCase();
  const selected = sources.find((source) => source.code === normalized);
  return (
    <Combobox
      open={open}
      onOpenChange={setOpen}
      value={normalized}
      query={value}
      onQueryChange={(next) => {
        const candidate = next.trim().toLowerCase();
        if (!candidate || SOURCE_CODE_PATTERN.test(candidate)) onValueChange(candidate);
      }}
      onValueChange={(next) => onValueChange(next ?? "")}
    >
      <ComboboxTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-0 justify-between">
          <span className="truncate">
            {selected ? `${selected.name} (${selected.code})` : normalized || "Select source"}
          </span>
          <Icons name="ChevronDown" size={16} aria-hidden="true" />
        </Button>
      </ComboboxTrigger>
      <ComboboxContent align="start">
        <ComboboxInput aria-label="Source code" placeholder="Type a source code…" maxLength={32} />
        <ComboboxList>
          <ComboboxItem value="" keywords={["No source"]}>
            No source
          </ComboboxItem>
          {sources.map((source) => (
            <ComboboxItem key={source.code} value={source.code} keywords={[source.name]}>
              {source.name} ({source.code})
            </ComboboxItem>
          ))}
          <ComboboxEmpty>This ad-hoc source will be used when copied.</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
