// Consistent color hashing for collaborative editing features.
// Used by PresenceAvatars (Tailwind classes) and remote cursors (hex colors).

const TW_COLORS = [
  "bg-rose-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-cyan-400",
  "bg-violet-400",
  "bg-pink-400",
  "bg-teal-400",
  "bg-indigo-400",
];

const HEX_COLORS = [
  "#fb7185", // rose-400
  "#fbbf24", // amber-400
  "#34d399", // emerald-400
  "#22d3ee", // cyan-400
  "#a78bfa", // violet-400
  "#f472b6", // pink-400
  "#2dd4bf", // teal-400
  "#818cf8", // indigo-400
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Tailwind background class (for avatar badges). */
export function hashColorTw(str: string): string {
  return TW_COLORS[hash(str) % TW_COLORS.length];
}

/** Hex color string (for CM6 cursor decorations). */
export function hashColorHex(str: string): string {
  return HEX_COLORS[hash(str) % HEX_COLORS.length];
}
