// Pure user_code formatting shared between the server-only device
// authorization storage and the /device route component (which needs it in
// the client bundle too), so it must not live in a *.server.ts module.

export function normalizeUserCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Formats a user code for display as issued (XXXX-XXXX), regardless of the case/dashes typed in. */
export function formatUserCode(value: string): string {
  const normalized = normalizeUserCode(value);
  return normalized.length > 4 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}
