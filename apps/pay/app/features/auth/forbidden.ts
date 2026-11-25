import { isRouteErrorResponse } from "react-router";

export const FORBIDDEN_REASONS = {
  "no-chapter": {
    title: "GDG チャプターへの参加が必要です",
    description:
      "GDG Japan Pay は GDG / GDG on Campus チャプターのメンバーが利用できます。サインイン中のアカウントはどのチャプターにも所属していません。チャプターに参加するか、所属しているアカウントでサインインし直してください。",
  },
  "not-proxy-registrar": {
    title: "このイベントの代行登録はできません",
    description:
      "代行登録は、イベントを登録した人と、イベントのチャプターのオーガナイザーだけが行えます。代行登録が必要な場合は、そのどちらかに依頼してください。",
  },
  "not-claim-viewer": {
    title: "この申請を開く権限がありません",
    description:
      "申請を開けるのは、申請者本人、代行登録した人、イベントを登録した人、イベントのチャプターのオーガナイザーです。自分の申請はイベントページの「自分の申請」から開けます。",
  },
  "not-claim-editor": {
    title: "この申請は編集できません",
    description:
      "本人申請を編集できるのは申請者本人だけです。代行申請は、代行登録した人、イベントを登録した人、イベントのチャプターのオーガナイザーが編集できます。",
  },
} as const satisfies Record<string, { title: string; description: string }>;

export type ForbiddenReason = keyof typeof FORBIDDEN_REASONS;

export function forbidden(reason: ForbiddenReason): Response {
  return Response.json({ reason }, { status: 403 });
}

function isForbiddenReason(value: unknown): value is ForbiddenReason {
  return typeof value === "string" && Object.hasOwn(FORBIDDEN_REASONS, value);
}

export function forbiddenReason(error: unknown): ForbiddenReason | null {
  if (!isRouteErrorResponse(error) || error.status !== 403) return null;
  const data: unknown = error.data;
  const reason = typeof data === "object" && data !== null && "reason" in data ? data.reason : null;
  return isForbiddenReason(reason) ? reason : null;
}
