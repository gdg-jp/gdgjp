import type { CandidateData, PageAccessEntry, PageRole, ShareSubject } from "./types";

export function initial(value: string) {
  return value.trim().charAt(0).toLocaleUpperCase() || "?";
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function subjectKey(subject: ShareSubject) {
  return `${subject.type}:${subject.key}`;
}

export function normalizeEntry(
  entry: PageAccessEntry,
): ShareSubject & { id: string; role: PageRole } {
  const type = entry.subjectType ?? "email";
  const secondary =
    type === "chapter" ? (entry.subjectKey ?? "") : (entry.email ?? entry.subjectKey ?? "");
  return {
    id: entry.id,
    type,
    key: entry.subjectKey ?? secondary,
    label: entry.subjectLabel ?? entry.userName ?? entry.email ?? secondary,
    secondary,
    image: entry.userImage,
    userId: entry.userId,
    role: entry.role ?? entry.pageRole ?? "viewer",
  };
}

export function normalizeCandidate(
  candidate: CandidateData["candidates"][number],
): ShareSubject | null {
  const type = candidate.type ?? candidate.subjectType;
  const key = candidate.key ?? candidate.subjectKey;
  const label = candidate.label ?? candidate.subjectLabel;
  if ((type !== "email" && type !== "chapter") || !key || !label) return null;
  return {
    type,
    key,
    label,
    secondary: candidate.secondary ?? candidate.secondaryText ?? key,
    image: candidate.image,
  };
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard access can be unavailable in embedded or insecure contexts.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy was rejected");
}
