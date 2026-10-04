const RESEND_API_URL = "https://api.resend.com/emails";

function sanitizeEmailHeader(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendClaimReviewEmail(
  env: Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM" | "COMM_SUPPORT_EMAIL">,
  opts: {
    eventTitle: string;
    applicantName: string;
    totalAmountLabel: string;
    sheetUrl: string;
  },
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  const to = sanitizeEmailHeader(env.COMM_SUPPORT_EMAIL || "comm-support@voice-research.com");
  const subject = sanitizeEmailHeader(
    `【経費精算】${opts.eventTitle} / ${opts.applicantName} の申請確認をお願いします`,
  );
  const text = [
    "申請スプレッドシートを作成したので確認お願いします。",
    "",
    `イベント名: ${opts.eventTitle}`,
    `申請者: ${opts.applicantName}`,
    `合計: ${opts.totalAmountLabel}`,
    `スプレッドシート: ${opts.sheetUrl}`,
  ].join("\n");
  const html = `
    <p>申請スプレッドシートを作成したので確認お願いします。</p>
    <ul>
      <li>イベント名: ${escapeHtml(opts.eventTitle)}</li>
      <li>申請者: ${escapeHtml(opts.applicantName)}</li>
      <li>合計: ${escapeHtml(opts.totalAmountLabel)}</li>
      <li>スプレッドシート: <a href="${escapeHtml(opts.sheetUrl)}">${escapeHtml(opts.sheetUrl)}</a></li>
    </ul>
  `;
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "GDG Japan Pay <noreply@gdgs.jp>",
      to,
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
  }
}
