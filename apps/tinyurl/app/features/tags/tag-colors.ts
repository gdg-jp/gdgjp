export const TAG_COLORS = ["red", "yellow", "green", "blue", "purple", "brown", "gray"] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(value: string): value is TagColor {
  return (TAG_COLORS as readonly string[]).includes(value);
}

export function normalizeColor(value: string | null | undefined): TagColor {
  if (!value) return "gray";
  const lower = value.toLowerCase();
  if (isTagColor(lower)) return lower;
  return "gray";
}

export const COLOR_CLASSES: Record<
  TagColor,
  { bg: string; text: string; ring: string; chip: string }
> = {
  red: {
    bg: "bg-red-100 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-300",
    ring: "ring-red-200 dark:ring-red-900",
    chip: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
  yellow: {
    bg: "bg-yellow-100 dark:bg-yellow-950/40",
    text: "text-yellow-700 dark:text-yellow-300",
    ring: "ring-yellow-200 dark:ring-yellow-900",
    chip: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
  },
  green: {
    bg: "bg-green-100 dark:bg-green-950/40",
    text: "text-green-700 dark:text-green-300",
    ring: "ring-green-200 dark:ring-green-900",
    chip: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  },
  blue: {
    bg: "bg-blue-100 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    ring: "ring-blue-200 dark:ring-blue-900",
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  purple: {
    bg: "bg-purple-100 dark:bg-purple-950/40",
    text: "text-purple-700 dark:text-purple-300",
    ring: "ring-purple-200 dark:ring-purple-900",
    chip: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  },
  brown: {
    bg: "bg-amber-100 dark:bg-amber-950/40",
    text: "text-amber-800 dark:text-amber-300",
    ring: "ring-amber-200 dark:ring-amber-900",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  gray: {
    bg: "bg-gray-100 dark:bg-gray-800/60",
    text: "text-gray-700 dark:text-gray-300",
    ring: "ring-gray-300 dark:ring-gray-700",
    chip: "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300",
  },
};
