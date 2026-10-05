import {
  Button,
  Checkbox,
  FormField,
  Icons,
  Inline,
  Label,
  NativeSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Stack,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from "@gdgjp/design-system";
import type { ReactNode } from "react";
import type { DisplayLayout, DisplayProperty } from "~/features/dashboard/display-preferences";

const PROPERTY_LABELS: Array<{ value: DisplayProperty; label: string }> = [
  { value: "shortLink", label: "Short link" },
  { value: "destinationUrl", label: "Destination URL" },
  { value: "title", label: "Title" },
  { value: "description", label: "Description" },
  { value: "createdDate", label: "Created date" },
  { value: "creator", label: "Creator" },
  { value: "tags", label: "Tags" },
  { value: "analytics", label: "Analytics" },
];

export function DashboardDisplayMenu({
  layout,
  onLayoutChange,
  sort,
  onSortChange,
  showArchived,
  onShowArchivedChange,
  properties,
  onPropertiesChange,
  showDefaultActions,
  onResetToDefault,
  onSetAsDefault,
  triggerClassName,
}: {
  layout: DisplayLayout;
  onLayoutChange: (layout: DisplayLayout) => void;
  sort: "newest" | "oldest" | "mostClicks";
  onSortChange: (sort: "newest" | "oldest" | "mostClicks") => void;
  showArchived: boolean;
  onShowArchivedChange: (showArchived: boolean) => void;
  properties: DisplayProperty[];
  onPropertiesChange: (properties: DisplayProperty[]) => void;
  showDefaultActions: boolean;
  onResetToDefault: () => void;
  onSetAsDefault: () => void;
  triggerClassName?: string;
}) {
  function toggleProperty(property: DisplayProperty) {
    onPropertiesChange(
      properties.includes(property)
        ? properties.filter((value) => value !== property)
        : [...properties, property],
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={triggerClassName}>
          <Icons name="SlidersHorizontal" size={18} aria-hidden="true" />
          Display
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-4">
        <Stack>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Display layout</legend>
            <ToggleGroup
              type="single"
              value={layout}
              onValueChange={(value) => {
                if (value) onLayoutChange(value as DisplayLayout);
              }}
            >
              <ToggleGroupItem value="cards">
                <Icons name="LayoutGrid" size={18} aria-hidden="true" />
                Cards
              </ToggleGroupItem>
              <ToggleGroupItem value="rows">
                <Icons name="LayoutList" size={18} aria-hidden="true" />
                Rows
              </ToggleGroupItem>
            </ToggleGroup>
          </fieldset>
          <FormField label="Ordering" id="link-ordering">
            <NativeSelect
              value={sort}
              onChange={(event) =>
                onSortChange(event.target.value as "newest" | "oldest" | "mostClicks")
              }
              onKeyDown={(event) => event.stopPropagation()}
            >
              <option value="newest">Date created · newest</option>
              <option value="oldest">Date created · oldest</option>
              <option value="mostClicks">Analytics · most clicks</option>
            </NativeSelect>
          </FormField>
          <Label className="flex items-center justify-between gap-3">
            Show archived links
            <Switch checked={showArchived} onCheckedChange={onShowArchivedChange} />
          </Label>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Display properties</legend>
            <Stack>
              {PROPERTY_LABELS.map(({ value, label }) => (
                <Label key={value} className="flex items-center gap-2">
                  <Checkbox
                    checked={properties.includes(value)}
                    onCheckedChange={() => toggleProperty(value)}
                  />
                  {label}
                </Label>
              ))}
            </Stack>
          </fieldset>
          {showDefaultActions && (
            <Inline className="flex-wrap justify-end">
              <Button variant="ghost" size="sm" onClick={onResetToDefault}>
                Reset to default
              </Button>
              <Button variant="secondary" size="sm" onClick={onSetAsDefault}>
                Set as default
              </Button>
            </Inline>
          )}
        </Stack>
      </PopoverContent>
    </Popover>
  );
}
