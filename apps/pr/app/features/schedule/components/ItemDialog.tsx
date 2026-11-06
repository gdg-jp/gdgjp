import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Textarea,
} from "@gdgjp/design-system";
import { Form, useNavigation } from "react-router";
import { toJstLocal } from "../calendar";
import type { ScheduleItem } from "../item";
import { type ItemFormErrors, NONE } from "../item-form";
import { ITEM_STATUSES, KIND_LABELS, REQUEST_KINDS, SCHEDULE_KINDS, STATUS_LABELS } from "../kinds";

export type Option = { value: string; label: string };

function Choice({
  name,
  label,
  options,
  value,
}: { name: string; label: string; options: Option[]; value: string | null }) {
  return (
    <FormField label={label}>
      <Select name={name} defaultValue={value ?? NONE}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>なし</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

/** Add or edit one schedule item. */
export function ItemDialog({
  open,
  onOpenChange,
  item,
  members,
  sessions,
  speakers,
  channels,
  errors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ScheduleItem | null;
  members: Option[];
  sessions: Option[];
  speakers: Option[];
  channels: Option[];
  errors: ItemFormErrors;
}) {
  const navigation = useNavigation();
  const isRequest = item ? REQUEST_KINDS.includes(item.kind) : false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{item ? "アイテムを編集" : "アイテムを追加"}</DialogTitle>
        <DialogDescription>
          投稿は 60 分前のスタッフ依頼、登壇者付きの X 投稿は 180 分前の引用依頼が自動で付きます。
        </DialogDescription>
        <Form method="post" noValidate key={item?.id ?? "new"}>
          <input type="hidden" name="intent" value={item ? "update" : "create"} />
          {item ? <input type="hidden" name="id" value={item.id} /> : null}
          <Stack>
            <FormField label="種類" required error={errors.kind}>
              <Select name="kind" defaultValue={item?.kind ?? "x_post"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="日時" required error={errors.dueAt}>
              <Input
                name="dueAt"
                type="datetime-local"
                defaultValue={item ? toJstLocal(item.dueAt) : ""}
              />
            </FormField>
            <FormField label="タイトル" required error={errors.title}>
              <Input name="title" defaultValue={item?.title ?? ""} maxLength={200} />
            </FormField>
            <Choice
              name="channel"
              label="チャネル"
              options={channels}
              value={item?.channel ?? null}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Choice
                name="assignee"
                label="担当"
                options={members}
                value={item?.assigneeUserId ?? null}
              />
              <Choice
                name="reviewer"
                label="レビュアー"
                options={members}
                value={item?.reviewerUserId ?? null}
              />
              <Choice
                name="sessionId"
                label="セッション"
                options={sessions}
                value={item?.sessionId ?? null}
              />
              <Choice
                name="speakerId"
                label="登壇者"
                options={speakers}
                value={item?.speakerId ?? null}
              />
            </div>
            <FormField
              label="告知開始の条件"
              description="session:<ID>:confirmed（セッション確定後）、item:<番号>:done、date:<日時>。カンマ区切り"
            >
              <Input name="blockedBy" defaultValue={item?.blockedBy.join(", ") ?? ""} />
            </FormField>
            {item ? (
              <FormField label="状態" error={errors.status}>
                <Select name="status" defaultValue={item.status}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
            {isRequest ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Choice
                  name="requestStatus"
                  label="依頼の状況"
                  options={[
                    { value: "sent", label: "送った（返事待ち）" },
                    { value: "replied", label: "返事あり" },
                    { value: "declined", label: "断られた" },
                  ]}
                  value={item?.requestStatus ?? null}
                />
                <FormField label="再連絡の期限" error={errors.followup}>
                  <Input
                    name="requestFollowupAt"
                    type="datetime-local"
                    defaultValue={item?.requestFollowupAt ? toJstLocal(item.requestFollowupAt) : ""}
                  />
                </FormField>
              </div>
            ) : null}
            <FormField label="メモ">
              <Textarea name="note" defaultValue={item?.note ?? ""} rows={2} />
            </FormField>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                キャンセル
              </Button>
              <Button type="submit" loading={navigation.state === "submitting"}>
                {item ? "保存" : "追加"}
              </Button>
            </div>
          </Stack>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
