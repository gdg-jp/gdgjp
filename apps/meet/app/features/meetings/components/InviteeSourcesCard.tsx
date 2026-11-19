import {
  Alert,
  Button,
  Card,
  FormField,
  Heading,
  IconButton,
  Icons,
  Inline,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Stack,
  Text,
  Textarea,
} from "@gdgjp/design-system";
import type { ChapterSummary } from "~/features/directory/directory";
import type { CreateMeetingFieldErrors } from "../form";
import { MAX_COHOSTS, MAX_INVITEES } from "../invitees";
import type { InviteePreviewCounts, InviteeRole } from "../meeting";

export type AdditionalChapterDraft = {
  key: string;
  chapterId: string;
  scope: "chapter_organizers" | "chapter_all";
  role: InviteeRole;
};

export type InviteePreviewData =
  | { ok: true; counts: InviteePreviewCounts }
  | { ok: false; error: string; counts?: InviteePreviewCounts };

export type InviteeSourcesCardProps = {
  allChapters: ChapterSummary[];
  additionalChapters: AdditionalChapterDraft[];
  onAddChapterRow: () => void;
  onUpdateChapterRow: (key: string, patch: Partial<Omit<AdditionalChapterDraft, "key">>) => void;
  onRemoveChapterRow: (key: string) => void;
  cohostEmails: string;
  onCohostEmailsChange: (value: string) => void;
  participantEmails: string;
  onParticipantEmailsChange: (value: string) => void;
  fieldErrors: CreateMeetingFieldErrors;
  onPreview: () => void;
  isPreviewLoading: boolean;
  previewData?: InviteePreviewData;
};

/** 他チャプター招待・個別メール招待・招待者数の事前プレビューカード。 */
export function InviteeSourcesCard({
  allChapters,
  additionalChapters,
  onAddChapterRow,
  onUpdateChapterRow,
  onRemoveChapterRow,
  cohostEmails,
  onCohostEmailsChange,
  participantEmails,
  onParticipantEmailsChange,
  fieldErrors,
  onPreview,
  isPreviewLoading,
  previewData,
}: InviteeSourcesCardProps) {
  return (
    <Card>
      <Stack>
        <Inline className="items-center justify-between">
          <Heading level={2}>追加の招待先</Heading>
          <Button
            variant="outline"
            size="sm"
            onClick={onAddChapterRow}
            disabled={allChapters.length === 0}
          >
            <Icons name="Plus" size={16} aria-hidden="true" />
            他チャプターを追加
          </Button>
        </Inline>

        {fieldErrors.additionalChapters && (
          <Alert tone="danger" title="他チャプターの設定エラー">
            {fieldErrors.additionalChapters}
          </Alert>
        )}

        {additionalChapters.length === 0 ? (
          <Text tone="muted" size="sm">
            他のチャプターの Organizer や Member
            をまとめて招待したい場合は「他チャプターを追加」から選択できます。
          </Text>
        ) : (
          <Stack>
            {additionalChapters.map((row) => (
              <div
                key={row.key}
                className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-end"
              >
                <Select
                  value={row.chapterId}
                  onValueChange={(value) => onUpdateChapterRow(row.key, { chapterId: value })}
                >
                  <SelectTrigger aria-label="招待するチャプター">
                    <SelectValue placeholder="チャプターを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {allChapters.map((chapter) => (
                      <SelectItem key={chapter.id} value={String(chapter.id)}>
                        {chapter.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={row.scope}
                  onValueChange={(value) =>
                    onUpdateChapterRow(row.key, {
                      scope: value as "chapter_organizers" | "chapter_all",
                    })
                  }
                >
                  <SelectTrigger aria-label="招待対象の範囲">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chapter_organizers">Organizer のみ</SelectItem>
                    <SelectItem value="chapter_all">Organizer + Member</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={row.role}
                  onValueChange={(value) =>
                    onUpdateChapterRow(row.key, { role: value as InviteeRole })
                  }
                >
                  <SelectTrigger aria-label="招待者の役割">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="participant">参加者</SelectItem>
                    <SelectItem value="cohost">共同主催者</SelectItem>
                  </SelectContent>
                </Select>

                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label="このチャプター招待を削除"
                  onClick={() => onRemoveChapterRow(row.key)}
                >
                  <Icons name="Trash2" size={16} aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </Stack>
        )}

        <Separator />

        <FormField
          label="個別に招待する共同主催者（co-host）のメールアドレス"
          description="改行またはカンマ区切りで入力できます。Google グループ（@googlegroups.com）は指定できません。"
          error={fieldErrors.cohostEmails}
        >
          <Textarea
            name="cohostEmails"
            rows={3}
            value={cohostEmails}
            onChange={(e) => onCohostEmailsChange(e.currentTarget.value)}
            placeholder="cohost@example.com"
          />
        </FormField>

        <FormField
          label="個別に招待する参加者のメールアドレス"
          description="改行またはカンマ区切りで入力できます。Google グループ（@googlegroups.com）は指定できません。"
          error={fieldErrors.participantEmails}
        >
          <Textarea
            name="participantEmails"
            rows={3}
            value={participantEmails}
            onChange={(e) => onParticipantEmailsChange(e.currentTarget.value)}
            placeholder="guest@example.com"
          />
        </FormField>

        <Separator />

        <Stack>
          <Inline className="items-center justify-between">
            <div>
              <Heading level={3}>招待者数の事前確認</Heading>
              <Text tone="muted" size="sm">
                チャプターメンバーのメールアドレスは画面に表示されず、重複統合後の人数のみを確認できます（上限:
                全体 {MAX_INVITEES} 人 / 共同主催者 {MAX_COHOSTS} 人）。
              </Text>
            </div>
            <Button variant="outline" onClick={onPreview} loading={isPreviewLoading}>
              人数を確認
            </Button>
          </Inline>

          {previewData && !previewData.ok && (
            <Alert tone="danger" title="招待者数の確認エラー">
              {previewData.error}
            </Alert>
          )}

          {previewData?.counts && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-muted">作成者</dt>
                <dd className="font-semibold">{previewData.counts.creatorCount} 名</dd>
              </div>
              <div>
                <dt className="text-muted">主催チャプター</dt>
                <dd className="font-semibold">{previewData.counts.hostChapterCount} 名</dd>
              </div>
              <div>
                <dt className="text-muted">他チャプター</dt>
                <dd className="font-semibold">{previewData.counts.otherChaptersCount} 名</dd>
              </div>
              <div>
                <dt className="text-muted">個別メール</dt>
                <dd className="font-semibold">{previewData.counts.emailCount} 名</dd>
              </div>
              <div>
                <dt className="text-muted">重複統合後 合計</dt>
                <dd className="font-semibold">
                  {previewData.counts.totalCount} 名（共同主催者 {previewData.counts.cohostCount} 名
                  / 参加者 {previewData.counts.participantCount} 名）
                </dd>
              </div>
            </dl>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
