import { Badge, Button, Card, Heading, Icons, Stack, Text } from "@gdgjp/design-system";
import { Link, useFetcher } from "react-router";
import { GROUP_LABELS, type Notice, groupNotices } from "../notice";

function NoticeAction({ notice }: { notice: Notice }) {
  const fetcher = useFetcher<{ ok?: boolean; message?: string; errors?: string[] }>();
  const action = notice.action;
  if (!action) return null;
  if (action.kind === "link")
    return (
      <Button asChild size="sm" variant={notice.urgency === 2 ? "primary" : "outline"}>
        <Link to={action.href}>{action.label}</Link>
      </Button>
    );
  if (fetcher.data?.ok) return <Text tone="muted">{fetcher.data.message ?? "記録しました"}</Text>;
  return (
    <fetcher.Form method="post" action={action.action}>
      {Object.entries(action.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant="outline" loading={fetcher.state !== "idle"}>
        {action.label}
      </Button>
    </fetcher.Form>
  );
}

/** Notices grouped (返事待ち, 提案, 今日の予定, 秘書が動いています), one button per line. */
export function NoticeList({
  notices,
  showCampaign = true,
  empty,
}: {
  notices: Notice[];
  showCampaign?: boolean;
  empty?: string;
}) {
  const groups = groupNotices(notices);
  if (!groups.length) return empty ? <Text tone="muted">{empty}</Text> : null;
  return (
    <Stack>
      {groups.map(({ group, notices: list }) => (
        <section key={group} aria-labelledby={`notices-${group}`}>
          <Heading level={2} id={`notices-${group}`} className="mb-2 text-base">
            {GROUP_LABELS[group]}
          </Heading>
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {list.map((n) => (
                <li key={n.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  {n.urgency === 2 && group === "waiting" ? (
                    <Icons name="AlertCircle" size={18} className="text-danger" aria-label="急ぎ" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {showCampaign && n.campaign ? (
                        <Badge tone="neutral">{n.campaign.name}</Badge>
                      ) : null}
                      <Link to={n.href} className="font-medium hover:underline">
                        {n.title}
                      </Link>
                    </div>
                    {n.detail ? (
                      <Text tone="muted" className="text-sm">
                        {n.detail}
                      </Text>
                    ) : null}
                  </div>
                  <NoticeAction notice={n} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </Stack>
  );
}
