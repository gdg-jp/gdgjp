import {
  DEFAULT_DISPLAY_PROPERTIES,
  type DisplayLayout,
  type DisplayProperty,
} from "~/components/dashboard-display-menu";

export type LinkSortKey = "newest" | "oldest" | "mostClicks";

export type DisplayPreferences = {
  layout: DisplayLayout;
  sort: LinkSortKey;
  showArchived: boolean;
  properties: DisplayProperty[];
};

export const DISPLAY_PREFERENCES_KEY = "gdgjp-tinyurl-display-v1";

const DISPLAY_PROPERTIES = new Set<DisplayProperty>([
  "shortLink",
  "destinationUrl",
  "title",
  "description",
  "createdDate",
  "creator",
  "tags",
  "analytics",
]);

export const BUILT_IN_DISPLAY_DEFAULTS: DisplayPreferences = {
  layout: "cards",
  sort: "newest",
  showArchived: false,
  properties: DEFAULT_DISPLAY_PROPERTIES,
};

export function readDisplayPreferences(storage: Pick<Storage, "getItem">): DisplayPreferences {
  const stored = storage.getItem(DISPLAY_PREFERENCES_KEY);
  if (!stored) {
    return {
      ...BUILT_IN_DISPLAY_DEFAULTS,
      properties: [...BUILT_IN_DISPLAY_DEFAULTS.properties],
    };
  }
  const parsed = JSON.parse(stored) as {
    layout?: unknown;
    sort?: unknown;
    showArchived?: unknown;
    properties?: unknown;
  };
  return {
    layout: parsed.layout === "cards" || parsed.layout === "rows" ? parsed.layout : "cards",
    sort:
      parsed.sort === "newest" || parsed.sort === "oldest" || parsed.sort === "mostClicks"
        ? parsed.sort
        : "newest",
    showArchived: typeof parsed.showArchived === "boolean" ? parsed.showArchived : false,
    properties: Array.isArray(parsed.properties)
      ? parsed.properties.filter(
          (property): property is DisplayProperty =>
            typeof property === "string" && DISPLAY_PROPERTIES.has(property as DisplayProperty),
        )
      : DEFAULT_DISPLAY_PROPERTIES,
  };
}
