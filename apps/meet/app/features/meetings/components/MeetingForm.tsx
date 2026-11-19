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
import type { AdditionalChapterRow, CreateMeetingFieldErrors } from "../form";
import {
  DEFAULT_MEETING_AUTO_ARTIFACTS,
  DEFAULT_TIME_ZONE,
  MEETING_ACCESS_TYPE_OPTIONS,
  type MeetingAccessType,
  type MeetingAutoArtifacts,
  TIME_ZONE_OPTIONS,
} from "../meeting";
import { AutoArtifactsCard } from "./AutoArtifactsCard";
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
  mode?: "create" | "edit";
  userChapters?: UserChapterOption[];
  primaryChapterId: number;
  hostChapterName?: string;
  allChapters: ChapterSummary[];
  defaultTitle?: string;
  defaultDescription?: string;
  defaultDate: string;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultTimeZone?: string;
  defaultAccessType?: MeetingAccessType;
  defaultAutoArtifacts?: MeetingAutoArtifacts;
  defaultIncludeHostOrganizers?: boolean;
  defaultAdditionalChapters?: AdditionalChapterRow[];
  defaultCohostEmails?: string;
  defaultParticipantEmails?: string;
  cancelTo?: string;
  canSubmit: boolean;
  fieldErrors?: CreateMeetingFieldErrors;
  formError?: string;
};

/** Google Meet 会議の作成・編集フォーム。 */
export function MeetingForm({
  mode = "create",
  userChapters = [],
  primaryChapterId,
  hostChapterName,
  allChapters,
  defaultTitle = "",
  defaultDescription = "",
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultTimeZone = DEFAULT_TIME_ZONE,
  defaultAccessType = "RESTRICTED",
  defaultAutoArtifacts = DEFAULT_MEETING_AUTO_ARTIFACTS,
  defaultIncludeHostOrganizers = true,
  defaultAdditionalChapters = [],
  defaultCohostEmails = "",
  defaultParticipantEmails = "",
  cancelTo = "/",
  canSubmit,
  fieldErrors = {},
  formError,
}: MeetingFormProps) {
  const isEdit = mode === "edit";
  const navigation = useNavigation();
  const previewFetcher = useFetcher<PreviewResponse>();
  const includeHostId = useId();
  const accessIdPrefix = useId();

  const [hostChapterId, setHostChapterId] = useState(
    String(primaryChapterId || userChapters[0]?.id || ""),
  );
  const [includeHostOrganizers, setIncludeHostOrganizers] = useState(defaultIncludeHostOrganizers);
  const [timeZone, setTimeZone] = useState(defaultTimeZone || DEFAULT_TIME_ZONE);
  const [accessType, setAccessType] = useState<MeetingAccessType>(defaultAccessType);
  const [autoArtifacts, setAutoArtifacts] = useState<MeetingAutoArtifacts>(defaultAutoArtifacts);
  const [additionalChapters, setAdditionalChapters] = useState<AdditionalChapterDraft[]>(() =>
    defaultAdditionalChapters.map((row, index) => ({
      key: `init-${index}`,
      chapterId: String(row.chapterId),
      scope: row.scope,
      role: row.role,
    })),
  );
  const [cohostEmails, setCohostEmails] = useState(defaultCohostEmails);
  const [participantEmails, setParticipantEmails] = useState(defaultParticipantEmails);
  const [rowCounter, setRowCounter] = useState(defaultAdditionalChapters.length);

  const timeZoneOptions = TIME_ZONE_OPTIONS.some((opt) => opt.value === timeZone)
    ? TIME_ZONE_OPTIONS
    : [{ value: timeZone, label: timeZone }, ...TIME_ZONE_OPTIONS];

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
      <input type="hidden" name="intent" value={isEdit ? "update" : "create"} />
      {isEdit && <input type="hidden" name="hostChapterId" value={hostChapterId} />}
      <input
        type="hidden"
        name="includeHostOrganizers"
        value={includeHostOrganizers ? "true" : "false"}
      />
      <input
        type="hidden"
        name="autoTranscription"
        value={autoArtifacts.autoTranscription ? "true" : "false"}
      />
      <input
        type="hidden"
        name="autoSmartNotes"
        value={autoArtifacts.autoSmartNotes ? "true" : "false"}
      />
      <input
        type="hidden"
        name="autoRecording"
        value={autoArtifacts.autoRecording ? "true" : "false"}
      />
      <input type="hidden" name="additionalChapters" value={serializedAdditionalChapters} />

      <Stack>
        {formError && (
          <Alert
            tone="danger"
            title={isEdit ? "会議を更新できませんでした" : "会議を作成できませんでした"}
          >
            {formError}
          </Alert>
        )}

        <Card>
          <Stack>
            <Heading level={2}>基本情報</Heading>

            <FormField label="会議タイトル" required error={fieldErrors.title}>
              <Input
                name="title"
                maxLength={200}
                defaultValue={defaultTitle}
                placeholder="例: GDG Tokyo 定例ミーティング"
              />
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
                  {timeZoneOptions.map((opt) => (
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
              <Textarea
                name="description"
                rows={4}
                maxLength={4000}
                defaultValue={defaultDescription}
              />
            </FormField>
          </Stack>
        </Card>

        <Card>
          <Stack>
            <Heading level={2}>主催チャプターとアクセス設定</Heading>

            {isEdit ? (
              <div>
                <Text size="sm" className="font-semibold">
                  主催チャプター
                </Text>
                <Text>{hostChapterName ?? `チャプター #${primaryChapterId}`}</Text>
                <Text tone="muted" size="sm">
                  主催チャプターおよび作成者は変更できません。作成者は常に共同主催者（co-host）として維持されます。
                </Text>
              </div>
            ) : (
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
            )}

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
                  {isEdit
                    ? "作成者は、この設定にかかわらず常に共同主催者（co-host）として登録されます。"
                    : "作成者であるあなたは、この設定にかかわらず常に共同主催者（co-host）として登録されます。"}
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

        <AutoArtifactsCard value={autoArtifacts} onChange={setAutoArtifacts} />

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
            <RouterLink to={cancelTo}>キャンセル</RouterLink>
          </Button>
          <Button type="submit" disabled={!canSubmit} loading={isSubmitting}>
            {isEdit ? "変更を保存" : "会議を作成"}
          </Button>
        </Inline>
      </Stack>
    </Form>
  );
}
