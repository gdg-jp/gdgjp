// Keep the class names literal so Tailwind includes each generated utility.
const AVATAR_CLASSES = [
  "bg-gdg-red",
  "bg-gdg-yellow",
  "bg-gdg-green",
  "bg-gdg-blue",
  "bg-gdg-blue",
  "bg-gdg-red",
  "bg-gdg-green",
  "bg-gdg-blue",
];
const CURSOR_COLORS = [
  "var(--gdg-red)",
  "var(--gdg-yellow)",
  "var(--gdg-green)",
  "var(--gdg-blue)",
  "var(--gdg-blue)",
  "var(--gdg-red)",
  "var(--gdg-green)",
  "var(--gdg-blue)",
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function hashColorTw(str: string): string {
  return AVATAR_CLASSES[hash(str) % AVATAR_CLASSES.length];
}

export function hashColorHex(str: string): string {
  return CURSOR_COLORS[hash(str) % CURSOR_COLORS.length];
}
