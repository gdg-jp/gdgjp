import type { ContactKind } from "./contact";
import { organizationKey } from "./contact";

/** Wiki category label → contact kind. */
const KIND_BY_LABEL: Record<string, ContactKind> = {
  コミュニティ: "community",
  学校: "school",
  大学: "school",
  サークル: "circle",
  企業: "company",
  SNS・媒体: "media",
  他イベント告知: "media",
  研究機関: "lab",
  その他: "org",
};

export type ImportedContact = {
  wikiPerson: string | null;
  kind: ContactKind;
  name: string;
  organization: string;
};

/** Split 「A、B（x、y）、C」 on 、 or , outside parentheses. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if ("(（".includes(char)) depth++;
    if (")）".includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && "、,，".includes(char)) {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /\d{2,4}-\d{2,4}-\d{3,4}/;

/**
 * Parse the Wiki page 「イベント告知対象とコネクション保有者」: `### <person>` headings under
 * 「人別の告知対象」, then `- <kind>: a、b、c`, plus the unassigned list. Emails and phone numbers
 * are dropped even if someone pasted them there (the page should not have them).
 */
export function parseOutreachPage(markdown: string): ImportedContact[] {
  const out: ImportedContact[] = [];
  let section = "";
  let person: string | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      section = h2[1] ?? "";
      person = null;
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      person = section.includes("人別") ? (h3[1] ?? "").replace(/\s*—.*$/, "").trim() : null;
      continue;
    }
    const entry = /^[-*]\s*([^:：]+)[:：]\s*(.+)$/.exec(line);
    if (!entry) continue;
    const kind = KIND_BY_LABEL[(entry[1] ?? "").trim()];
    if (!kind) continue;
    if (!section.includes("人別") && !section.includes("担当未記載")) continue;
    for (const name of splitList(entry[2] ?? "")) {
      if (EMAIL.test(name) || PHONE.test(name)) continue;
      out.push({
        wikiPerson: section.includes("人別") ? person : null,
        kind,
        name,
        organization: organizationKey(name),
      });
    }
  }
  return out;
}

/** Organizations reached through more than one Wiki person (ask only once). */
export function duplicateOrganizations(
  contacts: { organization: string; wikiPerson: string | null }[],
): Set<string> {
  const people = new Map<string, Set<string>>();
  for (const c of contacts) {
    if (!c.wikiPerson) continue;
    people.set(c.organization, (people.get(c.organization) ?? new Set()).add(c.wikiPerson));
  }
  return new Set([...people].filter(([, set]) => set.size > 1).map(([org]) => org));
}
