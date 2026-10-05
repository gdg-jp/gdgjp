export function isValidImageId(id: string): boolean {
  return /^[0-9A-Za-z]{8}$/.test(id);
}
