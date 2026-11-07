/** One line on the notifications page (and the event page's "next steps"). Pure. */
export type NoticeGroup = "waiting" | "proposal" | "today" | "running";

export type Notice = {
  key: string;
  group: NoticeGroup;
  /** 2: overdue or due within a day; 1: due within three days; 0: otherwise. */
  urgency: 0 | 1 | 2;
  campaign: { slug: string; name: string } | null;
  title: string;
  detail?: string;
  at?: number | null;
  href: string;
  action:
    | { kind: "link"; label: string; href: string }
    | { kind: "post"; label: string; action: string; fields: Record<string, string> }
    | null;
};

export const GROUP_LABELS: Record<NoticeGroup, string> = {
  waiting: "返事待ち",
  proposal: "提案",
  today: "今日の予定",
  running: "秘書が動いています",
};

export function urgencyOf(at: number | null | undefined, now: number): 0 | 1 | 2 {
  if (!at) return 0;
  if (at - now <= 86_400) return 2;
  if (at - now <= 3 * 86_400) return 1;
  return 0;
}

/** Most urgent first, then soonest, then in the order they were gathered. */
export function sortNotices(notices: Notice[]): Notice[] {
  return notices
    .map((n, i) => ({ n, i }))
    .sort(
      (a, b) =>
        b.n.urgency - a.n.urgency ||
        (a.n.at ?? Number.MAX_SAFE_INTEGER) - (b.n.at ?? Number.MAX_SAFE_INTEGER) ||
        a.i - b.i,
    )
    .map(({ n }) => n);
}

export function groupNotices(notices: Notice[]): { group: NoticeGroup; notices: Notice[] }[] {
  return (Object.keys(GROUP_LABELS) as NoticeGroup[])
    .map((group) => ({ group, notices: sortNotices(notices.filter((n) => n.group === group)) }))
    .filter((g) => g.notices.length > 0);
}

/**
 * More than `limit` notices of one kind in one campaign become one line ("レビュー待ちが 12 件"),
 * as urgent and as soon as the most urgent of them. Others pass through in order.
 */
export function collapse(
  notices: Notice[],
  kind: (n: Notice) => string | null,
  summary: (kind: string, list: Notice[]) => Pick<Notice, "title" | "href" | "action">,
  limit = 3,
): Notice[] {
  const groups = new Map<string, Notice[]>();
  for (const n of notices) {
    const k = kind(n);
    if (k) groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const out: Notice[] = [];
  const done = new Set<string>();
  for (const n of notices) {
    const k = kind(n);
    const list = k ? (groups.get(k) ?? []) : [];
    if (!k || list.length <= limit) {
      out.push(n);
      continue;
    }
    if (done.has(k)) continue;
    done.add(k);
    const first = sortNotices(list)[0] as Notice;
    out.push({
      ...first,
      key: `${k}:all`,
      detail: list
        .slice(0, 3)
        .map((x) => x.title)
        .join(" / "),
      ...summary(k, list),
    });
  }
  return out;
}
