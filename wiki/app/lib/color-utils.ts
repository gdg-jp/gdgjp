// Consistent color hashing for collaborative editing features.
// The values intentionally refer to semantic presence tokens from app.css so
// avatars and CodeMirror cursors follow the active color scheme.

const PRESENCE_TOKENS = ["rose", "amber", "emerald", "cyan", "violet", "pink", "teal", "indigo"];

// Keep the class names literal so Tailwind includes each generated utility.
const AVATAR_CLASSES = [
  "bg-presence-rose",
  "bg-presence-amber",
  "bg-presence-emerald",
  "bg-presence-cyan",
  "bg-presence-violet",
  "bg-presence-pink",
  "bg-presence-teal",
  "bg-presence-indigo",
];
const CURSOR_COLORS = PRESENCE_TOKENS.map((token) => `var(--color-presence-${token})`);

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Semantic Tailwind background class for avatar badges. */
export function hashColorTw(str: string): string {
  return AVATAR_CLASSES[hash(str) % AVATAR_CLASSES.length];
}

/** Theme-aware CSS color for CM6 cursor decorations. */
export function hashColorHex(str: string): string {
  return CURSOR_COLORS[hash(str) % CURSOR_COLORS.length];
}
