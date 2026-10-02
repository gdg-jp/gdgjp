import { Badge, Button, Card, Heading, Inline, Stack } from "@gdgjp/ui";
import { useState } from "react";
import type { SheetVisibility } from "~/features/roster-sheets/types";

/**
 * `/e/:id/share`'s single card (docs/roster/09-share-public-views.md
 * "Design" §1): one-click copy of `/r/:viewToken` and the default sheet's visibility,
 * mirroring `~/features/events/components/ApplyLinkCard`'s copy-button pattern.
 * Publication is managed from the event overview independently of recruitment.
 */
export function ShareCard({
  viewUrl,
  visibility,
}: { viewUrl: string; visibility: SheetVisibility }) {
  const isPublished = visibility === "published";

  return (
    <Card>
      <Stack>
        <Inline className="items-center justify-between">
          <Heading level={2}>本編の互換URL</Heading>
          <Badge tone={isPublished ? "success" : "neutral"}>
            {isPublished ? "公開中" : "非公開"}
          </Badge>
        </Inline>
        <p className="gdg-muted text-sm">旧形式のURLは、本編（既定のシフト表）を表示します。</p>
        {isPublished ? (
          <p className="text-sm">このURLを共有すると、誰でもサインインなしで閲覧できます。</p>
        ) : (
          <p className="text-sm">
            本編は現在非公開です。公開されるまで、このURLからシフト表の内容は見られません。
          </p>
        )}
        <ShareUrl url={viewUrl} label="本編の互換URLをコピー" />
      </Stack>
    </Card>
  );
}

export type ShareSheet = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  visibility: SheetVisibility;
  isDefault: boolean;
  viewUrl: string;
};

export function SheetShareList({ sheets }: { sheets: ShareSheet[] }) {
  return (
    <section aria-labelledby="sheet-share-heading">
      <Stack>
        <div>
          <Heading id="sheet-share-heading" level={2}>
            シフト表ごとのURL
          </Heading>
          <p className="gdg-muted text-sm">
            非公開のシフト表もURLを表示しますが、公開するまでは内容を閲覧できません。
          </p>
        </div>
        {sheets.length === 0 ? (
          <p className="gdg-muted text-sm">シフト表はまだありません。</p>
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {sheets.map((sheet) => (
              <li key={sheet.id}>
                <SheetShareCard sheet={sheet} />
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </section>
  );
}

function SheetShareCard({ sheet }: { sheet: ShareSheet }) {
  const isPublished = sheet.visibility === "published";

  return (
    <Card>
      <Stack>
        <Inline className="items-start justify-between">
          <Heading level={3} className="min-w-0 break-words">
            {sheet.name}
          </Heading>
          <Inline>
            {sheet.isDefault && <Badge tone="info">本編</Badge>}
            <Badge tone={isPublished ? "success" : "neutral"}>
              {isPublished ? "公開中" : "非公開"}
            </Badge>
          </Inline>
        </Inline>
        <p className="gdg-muted text-sm">
          <time dateTime={sheet.date}>{sheet.date}</time>
          <span aria-hidden="true"> · </span>
          <time dateTime={`${sheet.date}T${sheet.startTime}`}>{sheet.startTime}</time>
          <span aria-hidden="true">–</span>
          <time dateTime={`${sheet.date}T${sheet.endTime}`}>{sheet.endTime}</time>
        </p>
        <p className="text-sm">
          {isPublished
            ? "公開中です。URLを知っている人は誰でも閲覧できます。"
            : "非公開です。公開するまでURLからシフト表の内容は見られません。"}
        </p>
        <ShareUrl url={sheet.viewUrl} label={`「${sheet.name}」のURLをコピー`} />
      </Stack>
    </Card>
  );
}

function ShareUrl({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The text remains selectable if clipboard access is unavailable.
    }
  }

  return (
    <Inline className="items-center">
      <code className="min-w-0 flex-1 break-all rounded-lg bg-muted p-3 text-sm">{url}</code>
      <Button
        type="button"
        variant="secondary"
        aria-label={copied ? `${label}：コピーしました` : label}
        onClick={copyUrl}
      >
        {copied ? "コピーしました" : "コピー"}
      </Button>
      <output className="gdg-sr-only" aria-live="polite">
        {copied ? "クリップボードにコピーしました" : ""}
      </output>
    </Inline>
  );
}
