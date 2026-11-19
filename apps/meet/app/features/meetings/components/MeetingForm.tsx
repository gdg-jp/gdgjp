import {
  Alert,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  Inline,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
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
import { useId, useState } from "react";
import { Form, Link as RouterLink, useFetcher, useNavigation } from "react-router";
import type { ChapterSummary } from "~/features/directory/directory";
import type { CreateMeetingFieldErrors } from "../form";
import {
  DEFAULT_TIME_ZONE,
  MEETING_ACCESS_TYPE_OPTIONS,
  type MeetingAccessType,
  TIME_ZONE_OPTIONS,
} from "../meeting";
import {
  type AdditionalChapterDraft,
  type InviteePreviewData,
  InviteeSourcesCard,
} from "./InviteeSourcesCard";

export type UserChapterOption = {
  id: number;
  slug: string;
  name: string;
};

type PreviewResponse = {
  intent: "preview";
  preview: InviteePreviewData;
};

export type MeetingFormProps = {
  userChapters: UserChapterOption[];
  primaryChapterId: number;
  allChapters: ChapterSummary[];
  defaultDate: string;
  defaultStartTime: string;
  defaultEndTime: string;
  canSubmit: boolean;
  fieldErrors?: CreateMeetingFieldErrors;
  formError?: string;
};

/** Google Meet 会議の新規作成フォーム。 */
export function MeetingForm({
  userChapters,
  primaryChapterId,
  allChapters,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  canSubmit,
  fieldErrors = {},
  formError,
}: MeetingFormProps) {
  const navigation = useNavigation();
  const previewFetcher = useFetcher<PreviewResponse>();
  const includeHostId = useId();
  const accessIdPrefix = useId();

  const [hostChapterId, setHostChapterId] = useState(
    String(primaryChapterId || userChapters[0]?.id || ""),
  );
  const [includeHostOrganizers, setIncludeHostOrganizers] = useState(true);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [accessType, setAccessType] = useState<MeetingAccessType>("RESTRICTED");
  const [additionalChapters, setAdditionalChapters] = useState<AdditionalChapterDraft[]>([]);
  const [cohostEmails, setCohostEmails] = useState("");
  const [participantEmails, setParticipantEmails] = useState("");
  const [rowCounter, setRowCounter] = useState(0);

  const isSubmitting =
    navigation.state === "submitting" && navigation.formData?.get("intent") !== "preview";
  const isPreviewLoading = previewFetcher.state !== "idle";

  const serializedAdditionalChapters = JSON.stringify(
    additionalChapters
      .filter((row) => row.chapterId !== "")
      .map((row) => ({
        chapterId: Number(row.chapterId),
        scope: row.scope,
        role: row.role,
      })),
  );

  function handleAddChapterRow() {
    const nextKey = `row-${rowCounter + 1}`;
    setRowCounter((c) => c + 1);
    const defaultOther = allChapters.find((c) => String(c.id) !== hostChapterId) ?? allChapters[0];
    setAdditionalChapters((prev) => [
      ...prev,
      {
        key: nextKey,
        chapterId: defaultOther ? String(defaultOther.id) : "",
        scope: "chapter_organizers",
        role: "participant",
      },
    ]);
  }

  function handleUpdateChapterRow(
    key: string,
    patch: Partial<Omit<AdditionalChapterDraft, "key">>,
  ) {
    setAdditionalChapters((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function handleRemoveChapterRow(key: string) {
    setAdditionalChapters((prev) => prev.filter((row) => row.key !== key));
  }

  function handlePreview() {
    const data = new FormData();
    data.set("intent", "preview");
    data.set("hostChapterId", hostChapterId);
    data.set("includeHostOrganizers", includeHostOrganizers ? "true" : "false");
    data.set("additionalChapters", serializedAdditionalChapters);
    data.set("cohostEmails", cohostEmails);
    data.set("participantEmails", participantEmails);
    previewFetcher.submit(data, { method: "post" });
  }

  return (
    <Form method="post" noValidate>
      <input type="hidden" name="intent" value="create" />
      <input
        type="hidden"
        name="includeHostOrganizers"
        value={includeHostOrganizers ? "true" : "false"}
      />
      <input type="hidden" name="additionalChapters" value={serializedAdditionalChapters} />

      <Stack>
        {formError && (
          <Alert tone="danger" title="会議を作成できませんでした">
            {formError}
          </Alert>
        )}

        <Card>
          <Stack>
            <Heading level={2}>基本情報</Heading>

            <FormField label="会議タイトル" required error={fieldErrors.title}>
              <Input name="title" maxLength={200} placeholder="例: GDG Tokyo 定例ミーティング" />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="日付" required error={fieldErrors.date}>
                <Input name="date" type="date" defaultValue={defaultDate} />
              </FormField>
              <FormField label="開始時刻" required error={fieldErrors.startTime}>
                <Input name="startTime" type="time" defaultValue={defaultStartTime} />
              </FormField>
              <FormField label="終了時刻" required error={fieldErrors.endTime}>
                <Input name="endTime" type="time" defaultValue={defaultEndTime} />
              </FormField>
            </div>

            <FormField label="タイムゾーン" required error={fieldErrors.timeZone}>
              <Select name="timeZone" value={timeZone} onValueChange={setTimeZone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_ZONE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField
              label="説明"
              description="Google カレンダーの予定説明に記載されます。末尾にこの会議の管理ページ URL が自動で付きます。"
              error={fieldErrors.description}
            >
              <Textarea name="description" rows={4} maxLength={4000} />
            </FormField>
          </Stack>
        </Card>

        <Card>
          <Stack>
            <Heading level={2}>主催チャプターとアクセス設定</Heading>

            <FormField label="主催チャプター" required error={fieldErrors.hostChapterId}>
              <Select name="hostChapterId" value={hostChapterId} onValueChange={setHostChapterId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {userChapters.map((chapter) => (
                    <SelectItem key={chapter.id} value={String(chapter.id)}>
                      {chapter.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <div className="flex items-start gap-3">
              <Checkbox
                id={includeHostId}
                checked={includeHostOrganizers}
                onCheckedChange={(checked) => setIncludeHostOrganizers(checked === true)}
              />
              <div className="min-w-0">
                <Label htmlFor={includeHostId}>
                  主催チャプターの Organizer を共同主催者（co-host）として招待する
                </Label>
                <Text tone="muted" size="sm">
                  作成者であるあなたは、この設定にかかわらず常に共同主催者（co-host）として登録されます。
                </Text>
              </div>
            </div>

            <Separator />

            <FormField
              label="アクセスの種類"
              description="モデレーション（ホスト管理）は常に有効になります。"
              error={fieldErrors.accessType}
            >
              <RadioGroup
                name="accessType"
                value={accessType}
                onValueChange={(value) => setAccessType(value as MeetingAccessType)}
              >
                {MEETING_ACCESS_TYPE_OPTIONS.map((opt) => {
                  const itemId = `${accessIdPrefix}-${opt.value}`;
                  return (
                    <div key={opt.value} className="flex items-start gap-3">
                      <RadioGroupItem id={itemId} value={opt.value} />
                      <div className="min-w-0">
                        <Label htmlFor={itemId}>{opt.label}</Label>
                        <Text tone="muted" size="sm">
                          {opt.description}
                        </Text>
                      </div>
                    </div>
                  );
                })}
              </RadioGroup>
            </FormField>
          </Stack>
        </Card>

        <InviteeSourcesCard
          allChapters={allChapters}
          additionalChapters={additionalChapters}
          onAddChapterRow={handleAddChapterRow}
          onUpdateChapterRow={handleUpdateChapterRow}
          onRemoveChapterRow={handleRemoveChapterRow}
          cohostEmails={cohostEmails}
          onCohostEmailsChange={setCohostEmails}
          participantEmails={participantEmails}
          onParticipantEmailsChange={setParticipantEmails}
          fieldErrors={fieldErrors}
          onPreview={handlePreview}
          isPreviewLoading={isPreviewLoading}
          previewData={previewFetcher.data?.preview}
        />

        <Inline className="justify-end">
          <Button variant="outline" asChild>
            <RouterLink to="/">キャンセル</RouterLink>
          </Button>
          <Button type="submit" disabled={!canSubmit} loading={isSubmitting}>
            会議を作成
          </Button>
        </Inline>
      </Stack>
    </Form>
  );
}
