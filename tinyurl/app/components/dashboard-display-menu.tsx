import {
  Archive,
  ArrowDownWideNarrow,
  ArrowUpDown,
  ChevronDown,
  LayoutGrid,
  Rows3,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

export type DisplayLayout = "cards" | "rows";
export type DisplayProperty =
  | "shortLink"
  | "destinationUrl"
  | "title"
  | "description"
  | "createdDate"
  | "creator"
  | "tags"
  | "analytics";

export const DEFAULT_DISPLAY_PROPERTIES: DisplayProperty[] = [
  "shortLink",
  "destinationUrl",
  "createdDate",
  "creator",
  "tags",
  "analytics",
];

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={triggerClassName}>
          <SlidersHorizontal className="size-4 rotate-90" />
          <span className="truncate">Display</span>
          <ChevronDown className="ml-auto size-4 text-muted-foreground sm:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-[min(18.6rem,calc(100vw-2rem))] overflow-visible p-0"
        style={{ viewTransitionName: "display-menu" }}
      >
        <fieldset className="grid grid-cols-2 gap-2 p-3">
          <legend className="sr-only">Display layout</legend>
          <LayoutButton
            active={layout === "cards"}
            icon={<LayoutGrid className="size-5" />}
            label="Cards"
            onClick={() => onLayoutChange("cards")}
          />
          <LayoutButton
            active={layout === "rows"}
            icon={<Rows3 className="size-5" />}
            label="Rows"
            onClick={() => onLayoutChange("rows")}
          />
        </fieldset>

        <div className="flex flex-col gap-3 border-t px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ArrowUpDown className="size-4 text-muted-foreground" />
            Ordering
          </div>
          <label className="relative flex w-full items-center">
            <ArrowDownWideNarrow className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
            <select
              aria-label="Link ordering"
              value={sort}
              onChange={(event) =>
                onSortChange(event.target.value as "newest" | "oldest" | "mostClicks")
              }
              onKeyDown={(event) => event.stopPropagation()}
              className="h-9 w-full appearance-none rounded-md border bg-background py-1 pl-9 pr-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="newest">Date created · newest</option>
              <option value="oldest">Date created · oldest</option>
              <option value="mostClicks">Analytics · most clicks</option>
            </select>
            <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground">
              ⌄
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
          <div className="flex items-center gap-3 text-sm font-medium">
            <Archive className="size-4 text-muted-foreground" />
            Show archived links
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showArchived}
            aria-label="Show archived links"
            onClick={() => onShowArchivedChange(!showArchived)}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              showArchived ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "absolute left-0.5 top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform",
                showArchived ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </div>

        <div className="border-t px-4 py-3">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Display properties
          </p>
          <div className="flex flex-wrap gap-2">
            {PROPERTY_LABELS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={properties.includes(value)}
                onClick={() => toggleProperty(value)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  properties.includes(value)
                    ? "border-border bg-muted font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {showDefaultActions ? (
          <div className="flex items-center justify-end gap-1.5 border-t p-3">
            <Button variant="ghost" size="sm" className="px-2" onClick={onResetToDefault}>
              Reset to default
            </Button>
            <Button
              size="sm"
              className="bg-black px-3 text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
              onClick={onSetAsDefault}
            >
              Set as default
            </Button>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LayoutButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-border bg-muted/70" : "border-transparent hover:bg-muted/50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
