export type FolderNameValidation = { ok: true; name: string } | { ok: false };

export function validateFolderName(raw: string): FolderNameValidation {
  const name = raw.trim();
  if (name.length === 0 || name.length > 48) return { ok: false };
  return { ok: true, name };
}
