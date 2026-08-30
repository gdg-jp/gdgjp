export type FolderNameValidation = { ok: true; name: string } | { ok: false };

/**
 * Trims and validates an owner-supplied folder name: 1..48 characters after
 * trimming. Uniqueness (per chapter) is enforced by the DB, not here.
 */
export function validateFolderName(raw: string): FolderNameValidation {
  const name = raw.trim();
  if (name.length === 0 || name.length > 48) return { ok: false };
  return { ok: true, name };
}
