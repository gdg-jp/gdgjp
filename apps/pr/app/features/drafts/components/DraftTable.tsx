import { Badge, Table } from "@gdgjp/design-system";
import { Link } from "react-router";
import { DRAFT_KIND_LABELS, type DraftKind } from "../draft-kinds";
import { DRAFT_STATUS_LABELS, type DraftStatus } from "../state-machine";

export type DraftRow = {
  id: number;
  kind: DraftKind;
  title: string;
  status: DraftStatus;
  mustFails: number;
  version: number;
  updated: string;
  people: string;
};

const TONE: Record<DraftStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  generating: "info",
  drafting: "warning",
  in_review: "warning",
  needs_approval: "warning",
  approved: "success",
  rejected: "neutral",
  superseded: "neutral",
};

export function DraftTable({ slug, drafts }: { slug: string; drafts: DraftRow[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <th>下書き</th>
          <th>種類</th>
          <th>状態</th>
          <th>検査</th>
          <th>担当・レビュー</th>
          <th>更新</th>
        </tr>
      </thead>
      <tbody>
        {drafts.map((d) => (
          <tr key={d.id}>
            <td>
              <Link to={`/c/${slug}/drafts/${d.id}`} className="text-link">
                {d.title}
              </Link>
              <span className="text-xs text-muted"> 版 {d.version}</span>
            </td>
            <td>{DRAFT_KIND_LABELS[d.kind]}</td>
            <td>
              <Badge tone={TONE[d.status]}>{DRAFT_STATUS_LABELS[d.status]}</Badge>
            </td>
            <td>
              {d.mustFails ? (
                <Badge tone="danger">MUST {d.mustFails}</Badge>
              ) : (
                <Badge tone="success">OK</Badge>
              )}
            </td>
            <td className="text-sm">{d.people}</td>
            <td className="font-mono text-xs">{d.updated}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
