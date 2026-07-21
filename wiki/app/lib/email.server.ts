const FROM_ADDRESS = "GDG Wiki <noreply@gdgs.jp>";
const RESEND_API_URL = "https://api.resend.com/emails";

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

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

function requireHttpsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Non-HTTPS URL rejected: ${url}`);
  }
  return url;
}

async function sendViaResend(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
  text: string,
  idempotencyKey?: string,
): Promise<void> {
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Ingestion complete email
// ---------------------------------------------------------------------------

export interface IngestionCompleteEmailOpts {
  to: string;
  userName: string;
  sessionId: string;
  reviewUrl: string;
}

export async function sendIngestionCompleteEmail(
  env: Env,
  opts: IngestionCompleteEmailOpts,
): Promise<void> {
  const { to, userName, sessionId, reviewUrl } = opts;

  const safeToHeader = sanitizeEmailHeader(to);
  const safeUserName = escapeHtml(userName);
  const safeSessionId = escapeHtml(sessionId);
  const validatedReviewUrl = requireHttpsUrl(reviewUrl);
  const safeReviewUrlAttr = escapeHtml(validatedReviewUrl);

  const subject = "Your AI-generated draft is ready for review";

  const textBody = [
    `Hi ${userName},`,
    "",
    "Your AI ingestion has finished processing. A draft wiki page is ready for your review.",
    "",
    "Review your draft at:",
    validatedReviewUrl,
    "",
    `Session ID: ${sessionId}`,
    "",
    "— GDG Japan Wiki",
  ].join("\n");

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>${subject}</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#111;">
  <h2 style="font-size:20px;">Your draft is ready</h2>
  <p>Hi ${safeUserName},</p>
  <p>Your AI ingestion has finished processing. A draft wiki page is ready for your review.</p>
  <p style="margin:24px 0;">
    <a href="${safeReviewUrlAttr}" style="background:#1a73e8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
      Review Draft
    </a>
  </p>
  <p style="font-size:12px;color:#666;">Session ID: ${safeSessionId}</p>
</body>
</html>`;

  if (env.ENVIRONMENT !== "production") {
    console.log("[email.server] DEV MODE — would send ingestion-complete email:");
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Review URL: ${validatedReviewUrl}`);
    return;
  }

  await sendViaResend(
    env.RESEND_API_KEY,
    safeToHeader,
    subject,
    htmlBody,
    textBody,
    `ingestion-complete/${sessionId}`,
  );
}

// ---------------------------------------------------------------------------
// Invitation email
// ---------------------------------------------------------------------------

export interface InvitationEmailOpts {
  to: string;
  role: "lead" | "member" | "viewer";
  chapterName: string;
  siteUrl: string;
}

/**
 * Sends an invitation email via Resend.
 * In non-production environments, logs the email content instead.
 */
export async function sendInvitationEmail(env: Env, opts: InvitationEmailOpts): Promise<void> {
  const { to, role, chapterName, siteUrl } = opts;

  const safeToHeader = sanitizeEmailHeader(to);
  const safeChapterName = escapeHtml(chapterName);

  const roleLabelEn = role === "lead" ? "Chapter Lead" : role === "member" ? "Member" : "Viewer";

  const subject = `You're invited to join ${chapterName} on GDG Japan Wiki`;

  const textBody = [
    "Hi,",
    "",
    `You have been invited to join the ${chapterName} chapter on GDG Japan Wiki as a ${roleLabelEn}.`,
    "",
    "To accept your invitation, simply sign in with your Google account at:",
    siteUrl,
    "",
    "Your invitation will be automatically applied when you sign in for the first time.",
    "",
    "If you did not expect this invitation, you can safely ignore this email.",
    "",
    "— GDG Japan Wiki",
  ].join("\n");

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>${subject}</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#111;">
  <h2 style="font-size:20px;">You're invited to GDG Japan Wiki</h2>
  <p>You have been invited to join the <strong>${safeChapterName}</strong> chapter as a <strong>${roleLabelEn}</strong>.</p>
  <p>To accept your invitation, sign in with your Google account:</p>
  <p style="margin:24px 0;">
    <a href="${escapeHtml(siteUrl)}" style="background:#1a73e8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
      Sign in to GDG Japan Wiki
    </a>
  </p>
  <p style="font-size:12px;color:#666;">Your invitation will be automatically applied when you sign in for the first time. If you did not expect this invitation, you can safely ignore this email.</p>
</body>
</html>`;

  if (env.ENVIRONMENT !== "production") {
    console.log("[email.server] DEV MODE — would send email:");
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body:\n${textBody}`);
    return;
  }

  await sendViaResend(env.RESEND_API_KEY, safeToHeader, subject, htmlBody, textBody);
}

// ---------------------------------------------------------------------------
// Page share email
// ---------------------------------------------------------------------------

export interface PageShareEmailOpts {
  to: string;
  pageTitle: string;
  pageUrl: string;
  role: "viewer" | "commenter" | "editor";
  sharedByName: string;
  message?: string;
}

const PAGE_ROLE_LABEL: Record<PageShareEmailOpts["role"], string> = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
};

/** Sends a sharing notice for a directly-addressed email grant (never Chapters). */
export async function sendPageShareEmail(env: Env, opts: PageShareEmailOpts): Promise<void> {
  // Development uses a localhost URL and only logs the notification; production
  // mail links must remain HTTPS.
  const pageUrl =
    env.ENVIRONMENT === "production"
      ? requireHttpsUrl(opts.pageUrl)
      : new URL(opts.pageUrl).toString();
  const subject = `${opts.sharedByName} shared “${opts.pageTitle}” with you`;
  const roleLabel = PAGE_ROLE_LABEL[opts.role];
  const safeTitle = escapeHtml(opts.pageTitle);
  const safeSharedBy = escapeHtml(opts.sharedByName);
  const safeUrl = escapeHtml(pageUrl);
  const safeMessage = opts.message?.trim() ? escapeHtml(opts.message.trim()) : null;

  const textBody = [
    "Hi,",
    "",
    `${opts.sharedByName} shared “${opts.pageTitle}” with you as a ${roleLabel}.`,
    ...(opts.message?.trim() ? ["", opts.message.trim()] : []),
    "",
    pageUrl,
    "",
    "— GDG Japan Wiki",
  ].join("\n");
  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>${escapeHtml(subject)}</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#111;">
  <h2 style="font-size:20px;">A page was shared with you</h2>
  <p><strong>${safeSharedBy}</strong> shared <strong>${safeTitle}</strong> with you as a <strong>${roleLabel}</strong>.</p>
  ${safeMessage ? `<p style="white-space:pre-wrap;">${safeMessage}</p>` : ""}
  <p style="margin:24px 0;"><a href="${safeUrl}" style="background:#1a73e8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Open page</a></p>
</body>
</html>`;

  if (env.ENVIRONMENT !== "production") {
    console.log("[email.server] DEV MODE — would send page-share email:");
    console.log(`  To: ${opts.to}`);
    console.log(`  Subject: ${subject}`);
    return;
  }

  await sendViaResend(
    env.RESEND_API_KEY,
    sanitizeEmailHeader(opts.to),
    subject,
    htmlBody,
    textBody,
  );
}
