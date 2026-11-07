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

/** Split 「A、B（x、y）／C」 on 、 , or ／ outside parentheses. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if ("(（".includes(char)) depth++;
    if (")）".includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && "、,，／".includes(char)) {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /\d{2,4}-\d{2,4}-\d{3,4}/;

/** Kind label, or the first of 「学校／ゼミ」-style combined labels, → contact kind. */
function kindOf(label: string): ContactKind | undefined {
  const clean = label.replace(/<[^>]*>/g, "").trim();
  return (
    KIND_BY_LABEL[clean] ??
    KIND_BY_LABEL[clean.split(/[／/]/)[0]?.trim() ?? ""] ??
    (clean.startsWith("SNS") ? "media" : undefined)
  );
}

/** Table cells of a `| a | b |` row, ACL span tags and Markdown links reduced to their text. */
function cells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) =>
      cell
        .replace(/<\/?acl\b[^>]*>/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim(),
    );
}

/** `### [Name](link) — note` → Name */
function personOf(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\[|\]$/g, "")
    .replace(/\s*—.*$/, "")
    .trim();
}

const safe = (name: string) => !!name && !EMAIL.test(name) && !PHONE.test(name);

/**
 * Parse the Wiki page 「イベント告知対象とコネクション保有者」. Under 「人別の告知対象」 each
 * `### <person>` has either a table (`| 告知対象 | 種別 | … |`) or `- <kind>: a、b、c` lines; a
 * `| 人 | 告知対象 | 種別 |` table lists several targets per person (`a / b`). 「担当未記載」
 * entries have no person. Emails and phone numbers are dropped even if someone pasted them there
 * (the page should not have them), and so are rows whose kind is not one we know.
 */
export function parseOutreachPage(markdown: string): ImportedContact[] {
  const out: ImportedContact[] = [];
  let section = "";
  let person: string | null = null;
  /** Column indexes of the current table, or null outside a table. */
  let table: { name: number; kind: number; person: number } | null = null;
  const push = (wikiPerson: string | null, kind: ContactKind, raw: string) => {
    // 「名前。補足の文」: keep the name only.
    const name = raw.replace(/。.*$/, "").trim();
    if (safe(name)) out.push({ wikiPerson, kind, name, organization: organizationKey(name) });
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const inScope = section.includes("人別") || section.includes("担当未記載");
    if (!line.startsWith("|")) table = null;
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      section = h2[1] ?? "";
      person = null;
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      person = section.includes("人別") ? personOf(h3[1] ?? "") : null;
      continue;
    }
    if (!inScope) continue;
    if (line.startsWith("|")) {
      const row = cells(line);
      if (!table) {
        const name = row.indexOf("告知対象");
        const kind = row.indexOf("種別");
        table = { name, kind, person: row.indexOf("人") };
        continue;
      }
      if (row.every((cell) => /^:?-+:?$/.test(cell)) || table.name < 0 || table.kind < 0) continue;
      const rowPerson =
        table.person >= 0
          ? personOf(row[table.person] ?? "") || null
          : section.includes("人別")
            ? person
            : null;
      const names = (row[table.name] ?? "").split(/\s+\/\s+/).flatMap(splitList);
      const kinds = (row[table.kind] ?? "").split(/[／/]/).map(kindOf);
      names.forEach((name, i) => {
        const kind =
          (kinds.length === names.length ? kinds[i] : kinds[0]) ??
          kindOf(row[table?.kind ?? 0] ?? "");
        if (kind) push(rowPerson, kind, name);
      });
      continue;
    }
    const entry = /^[-*]\s*([^:：]+)[:：]\s*(.+)$/.exec(line);
    if (!entry) continue;
    const kind = kindOf(entry[1] ?? "");
    if (!kind) continue;
    for (const name of splitList(entry[2] ?? ""))
      push(section.includes("人別") ? person : null, kind, name);
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
