import {
  Badge,
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  IconButton,
  Icons,
  Inline,
  Stack,
} from "@gdgjp/design-system";
import { useState } from "react";
import type { Tag } from "~/features/tags/tag-record";
export function TagCombobox({
  availableTags,
  selectedIds,
  newTagNames,
  onChange,
  disabled,
}: {
  availableTags: Tag[];
  selectedIds: number[];
  newTagNames: string[];
  onChange: (ids: number[], newNames: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const selected = availableTags.filter((tag) => selectedIds.includes(tag.id));
  const exactMatch = availableTags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate =
    trimmed.length > 0 &&
    trimmed.length <= 32 &&
    !exactMatch &&
    !newTagNames.some((name) => name.toLowerCase() === trimmed.toLowerCase());
  return (
    <Stack>
      <Inline className="flex-wrap">
        {selected.map((tag) => (
          <Badge key={tag.id}>
            {tag.name}
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={`Remove ${tag.name}`}
              disabled={disabled}
              onClick={() =>
                onChange(
                  selectedIds.filter((id) => id !== tag.id),
                  newTagNames,
                )
              }
            >
              <Icons name="X" size={14} aria-hidden="true" />
            </IconButton>
          </Badge>
        ))}
        {newTagNames.map((name) => (
          <Badge key={name}>
            {name}
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={`Remove ${name}`}
              disabled={disabled}
              onClick={() =>
                onChange(
                  selectedIds,
                  newTagNames.filter((value) => value !== name),
                )
              }
            >
              <Icons name="X" size={14} aria-hidden="true" />
            </IconButton>
          </Badge>
        ))}
      </Inline>
      <Combobox
        query={query}
        onQueryChange={setQuery}
        closeOnSelect={false}
        onValueChange={(value) => {
          if (!value) return;
          if (value === "create") onChange(selectedIds, [...newTagNames, trimmed]);
          else onChange([...selectedIds, Number(value)], newTagNames);
          setQuery("");
        }}
      >
        <ComboboxTrigger asChild>
          <Button variant="outline" disabled={disabled} className="justify-between" fullWidth>
            <span>Search or add tags...</span>
            <Icons name="ChevronsUpDown" size={18} aria-hidden="true" />
          </Button>
        </ComboboxTrigger>
        <ComboboxContent align="start" className="max-w-[calc(100vw-2rem)]">
          <ComboboxInput aria-label="Search tags" placeholder="Search or add tags..." />
          <ComboboxList>
            {availableTags
              .filter((tag) => !selectedIds.includes(tag.id))
              .map((tag) => (
                <ComboboxItem key={tag.id} value={String(tag.id)} keywords={[tag.name]}>
                  {tag.name}
                </ComboboxItem>
              ))}
            {canCreate && (
              <ComboboxItem value="create" keywords={[trimmed]}>
                Create "{trimmed}"
              </ComboboxItem>
            )}
            <ComboboxEmpty>No tags found.</ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Stack>
  );
}
