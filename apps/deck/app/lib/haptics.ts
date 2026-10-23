/** A short vibration where supported (not iOS Safari). */
export function buzz(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // unsupported
  }
}
