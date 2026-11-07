import { Badge, Button, Checkbox, Icons } from "@gdgjp/design-system";
import { Link } from "react-router";
import { jstTime } from "../calendar";
import type { ScheduleItem } from "../item";
import { KIND_LABELS, STATUS_LABELS } from "../kinds";

const TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  planned: "neutral",
  drafting: "info",
  in_review: "warning",
  needs_approval: "warning",
  approved: "success",
  dispatching: "info",
  scheduled: "success",
  done: "success",
  failed: "danger",
  skipped: "neutral",
};

export function ItemRow({
  item,
  derived,
  pending,
  people,
  onEdit,
  selectForm,
  draftHref,
}: {
  item: ScheduleItem;
  derived?: boolean;
  pending: string[];
  people: Record<string, string>;
  onEdit: (item: ScheduleItem) => void;
  /** When set, a checkbox submits this item's id with that form (draftable posts only). */
  selectForm?: string;
  /** The item's draft, when it has one. */
  draftHref?: string;
}) {
  const blocked = pending.length > 0;
  return (
    <li
      className={`flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 ${derived ? "ml-6 border-dashed" : ""} ${blocked ? "opacity-60" : ""}`}
      data-item-id={item.id}
    >
      {selectForm ? (
        <Checkbox
          form={selectForm}
          name="itemIds"
          value={String(item.id)}
          disabled={blocked}
          aria-label={`「${item.title}」の下書きを作る`}
          className="mt-0.5"
        />
      ) : null}
      <span className="w-12 shrink-0 font-mono text-sm text-muted">{jstTime(item.dueAt)}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{KIND_LABELS[item.kind]}</Badge>
          <span className="font-medium">{item.title}</span>
          <Badge tone={TONE[item.status] ?? "neutral"}>{STATUS_LABELS[item.status]}</Badge>
          {item.requestStatus ? (
            <Badge tone="info">
              {{ sent: "返事待ち", replied: "返事あり", declined: "断られた" }[item.requestStatus]}
            </Badge>
          ) : null}
        </div>
        <div className="text-sm text-muted">
          {[
            item.assigneeUserId
              ? `担当 ${people[item.assigneeUserId] ?? item.assigneeUserId}`
              : "担当なし",
            item.reviewerUserId
              ? `レビュー ${people[item.reviewerUserId] ?? item.reviewerUserId}`
              : null,
            item.note,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {blocked ? (
          <div className="flex items-center gap-1 text-sm text-warning">
            <Icons name="Clock" size={14} aria-hidden="true" />
            待ち: {pending.join("、")}
          </div>
        ) : null}
      </div>
      {draftHref ? (
        <Button asChild size="sm" variant="outline">
          <Link to={draftHref}>
            <Icons name="FileText" size={14} aria-hidden="true" />
            下書き
          </Link>
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => onEdit(item)}>
        <Icons name="Pencil" size={14} aria-hidden="true" />
        編集
      </Button>
    </li>
  );
}
