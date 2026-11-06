export function generateSlug(title: string, englishHint?: string): string {
  const source = englishHint?.trim() || title;
  return (
    source
      .toLowerCase()
      .replace(/[\s\u3000]+/g, "-")
      .replace(/[^\w-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || `page-${Date.now()}`
  );
}
