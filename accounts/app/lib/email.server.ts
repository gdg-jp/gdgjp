import { Resend } from "resend";
import type { Chapter, UserSummary } from "./db";

type Locale = "ja" | "en";

export type EmailEnv = {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  APP_URL: string;
};

export type EmailDeps = {
  env: EmailEnv;
  ctx?: ExecutionContext;
  locale?: Locale;
};

const DEFAULT_FROM = "GDG Japan <noreply@gdgs.jp>";

let warnedNoKey = false;
const resendClients = new Map<string, Resend>();
function getClient(env: EmailEnv): Resend | null {
  if (!env.RESEND_API_KEY) {
    if (!warnedNoKey) {
      console.warn("[email] RESEND_API_KEY missing — email sends will be skipped");
      warnedNoKey = true;
    }
    return null;
  }
  let client = resendClients.get(env.RESEND_API_KEY);
  if (!client) {
    client = new Resend(env.RESEND_API_KEY);
    resendClients.set(env.RESEND_API_KEY, client);
  }
  return client;
}

type RenderedEmail = { subject: string; html: string; text: string };

function userDisplayName(user: { name?: string | null; email: string }): string {
  return user.name?.trim() || user.email;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(args: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  cta?: { label: string; href: string };
  bodyText: string;
}): { html: string; text: string } {
  const ctaHtml = args.cta
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(args.cta.href)}" style="display:inline-block;background:#1a73e8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:500;">${escapeHtml(args.cta.label)}</a></p>`
    : "";
  const ctaText = args.cta ? `\n\n${args.cta.label}: ${args.cta.href}` : "";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(args.heading)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328;">
<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(args.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;border:1px solid #e6e8eb;">
    <tr><td style="padding:28px 32px 8px;">
      <div style="font-weight:600;font-size:14px;letter-spacing:.02em;color:#5f6368;">GDG Japan</div>
    </td></tr>
    <tr><td style="padding:8px 32px 28px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.4;font-weight:600;">${escapeHtml(args.heading)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#374151;">${args.bodyHtml}</div>
      ${ctaHtml}
      <hr style="border:0;border-top:1px solid #e6e8eb;margin:24px 0 16px;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">GDG Japan · accounts.gdgs.jp</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = `${args.heading}\n\n${args.bodyText}${ctaText}\n\n— GDG Japan`;
  return { html, text };
}

function renderRequestSubmitted(
  locale: Locale,
  args: { chapter: Chapter; requester: UserSummary; appUrl: string },
): RenderedEmail {
  const name = userDisplayName(args.requester);
  const cta = {
    label: locale === "ja" ? "リクエストを確認" : "Review request",
    href: `${args.appUrl}/chapters/${args.chapter.slug}/organize`,
  };
  if (locale === "ja") {
    const subject = `【${args.chapter.name}】参加リクエストが届きました`;
    return {
      subject,
      ...layout({
        preheader: `${name} さんから ${args.chapter.name} への参加リクエスト`,
        heading: `${args.chapter.name} に新しい参加リクエスト`,
        bodyHtml: `<p><strong>${escapeHtml(name)}</strong> さん（${escapeHtml(args.requester.email)}）から <strong>${escapeHtml(args.chapter.name)}</strong> への参加リクエストが届きました。</p><p>運営ページから承認または却下できます。</p>`,
        bodyText: `${name} さん (${args.requester.email}) から ${args.chapter.name} への参加リクエストが届きました。運営ページから承認または却下できます。`,
        cta,
      }),
    };
  }
  const subject = `New join request for ${args.chapter.name}`;
  return {
    subject,
    ...layout({
      preheader: `${name} requested to join ${args.chapter.name}`,
      heading: `New join request for ${args.chapter.name}`,
      bodyHtml: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(args.requester.email)}) has requested to join <strong>${escapeHtml(args.chapter.name)}</strong>.</p><p>You can approve or reject the request from the chapter organize page.</p>`,
      bodyText: `${name} (${args.requester.email}) has requested to join ${args.chapter.name}. You can approve or reject the request from the chapter organize page.`,
      cta,
    }),
  };
}

function renderRequestApproved(
  locale: Locale,
  args: { chapter: Chapter; appUrl: string },
): RenderedEmail {
  const cta = {
    label: locale === "ja" ? "ダッシュボードを開く" : "Open dashboard",
    href: `${args.appUrl}/dashboard`,
  };
  if (locale === "ja") {
    return {
      subject: `【${args.chapter.name}】参加が承認されました`,
      ...layout({
        preheader: `${args.chapter.name} のメンバーになりました`,
        heading: `${args.chapter.name} へようこそ`,
        bodyHtml: `<p><strong>${escapeHtml(args.chapter.name)}</strong> への参加リクエストが承認されました。これでメンバーとして活動できます。</p>`,
        bodyText: `${args.chapter.name} への参加リクエストが承認されました。`,
        cta,
      }),
    };
  }
  return {
    subject: `Your request to join ${args.chapter.name} was approved`,
    ...layout({
      preheader: `Welcome to ${args.chapter.name}`,
      heading: `Welcome to ${args.chapter.name}`,
      bodyHtml: `<p>Your request to join <strong>${escapeHtml(args.chapter.name)}</strong> has been approved. You're now an active member.</p>`,
      bodyText: `Your request to join ${args.chapter.name} has been approved. You're now an active member.`,
      cta,
    }),
  };
}

function renderRequestRejected(
  locale: Locale,
  args: { chapter: Chapter; appUrl: string },
): RenderedEmail {
  const cta = {
    label: locale === "ja" ? "他のチャプターを見る" : "Browse chapters",
    href: `${args.appUrl}/chapters`,
  };
  if (locale === "ja") {
    return {
      subject: `【${args.chapter.name}】参加リクエストの結果`,
      ...layout({
        preheader: `${args.chapter.name} への参加リクエストについて`,
        heading: "参加リクエストの結果",
        bodyHtml: `<p><strong>${escapeHtml(args.chapter.name)}</strong> への参加リクエストは承認されませんでした。他のチャプターへの参加もご検討ください。</p>`,
        bodyText: `${args.chapter.name} への参加リクエストは承認されませんでした。他のチャプターへの参加もご検討ください。`,
        cta,
      }),
    };
  }
  return {
    subject: `Update on your request to join ${args.chapter.name}`,
    ...layout({
      preheader: `Your request to join ${args.chapter.name}`,
      heading: "Update on your join request",
      bodyHtml: `<p>Your request to join <strong>${escapeHtml(args.chapter.name)}</strong> was not approved. You're welcome to explore other chapters.</p>`,
      bodyText: `Your request to join ${args.chapter.name} was not approved. You're welcome to explore other chapters.`,
      cta,
    }),
  };
}

function renderMemberLeft(
  locale: Locale,
  args: { chapter: Chapter; formerMember: UserSummary; appUrl: string },
): RenderedEmail {
  const name = userDisplayName(args.formerMember);
  const cta = {
    label: locale === "ja" ? "メンバー一覧を確認" : "Open organize page",
    href: `${args.appUrl}/chapters/${args.chapter.slug}/organize`,
  };
  if (locale === "ja") {
    return {
      subject: `【${args.chapter.name}】メンバーが退会しました`,
      ...layout({
        preheader: `${name} さんが ${args.chapter.name} を退会しました`,
        heading: "メンバーが退会しました",
        bodyHtml: `<p><strong>${escapeHtml(name)}</strong> さん（${escapeHtml(args.formerMember.email)}）が <strong>${escapeHtml(args.chapter.name)}</strong> を退会しました。</p>`,
        bodyText: `${name} (${args.formerMember.email}) が ${args.chapter.name} を退会しました。`,
        cta,
      }),
    };
  }
  return {
    subject: `${name} left ${args.chapter.name}`,
    ...layout({
      preheader: `${name} left ${args.chapter.name}`,
      heading: `A member left ${args.chapter.name}`,
      bodyHtml: `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(args.formerMember.email)}) has left <strong>${escapeHtml(args.chapter.name)}</strong>.</p>`,
      bodyText: `${name} (${args.formerMember.email}) has left ${args.chapter.name}.`,
      cta,
    }),
  };
}

async function dispatch(
  deps: EmailDeps,
  to: string | string[],
  rendered: RenderedEmail,
): Promise<void> {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to];
  if (recipients.length === 0) return;
  const client = getClient(deps.env);
  if (!client) return;
  const from = deps.env.EMAIL_FROM || DEFAULT_FROM;
  try {
    await client.emails.send({
      from,
      to: recipients,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (err) {
    console.error("[email] send failed", err);
  }
}

function fireAndForget(deps: EmailDeps, p: Promise<void>): Promise<void> {
  if (deps.ctx) {
    deps.ctx.waitUntil(p);
    return Promise.resolve();
  }
  return p;
}

export function sendJoinRequestSubmitted(
  deps: EmailDeps,
  args: { chapter: Chapter; requester: UserSummary; organizerEmails: string[] },
): Promise<void> {
  if (args.organizerEmails.length === 0) return Promise.resolve();
  const rendered = renderRequestSubmitted(deps.locale ?? "ja", {
    chapter: args.chapter,
    requester: args.requester,
    appUrl: deps.env.APP_URL,
  });
  return fireAndForget(deps, dispatch(deps, args.organizerEmails, rendered));
}

export function sendJoinRequestApproved(
  deps: EmailDeps,
  args: { chapter: Chapter; userEmail: string },
): Promise<void> {
  if (!args.userEmail) return Promise.resolve();
  const rendered = renderRequestApproved(deps.locale ?? "ja", {
    chapter: args.chapter,
    appUrl: deps.env.APP_URL,
  });
  return fireAndForget(deps, dispatch(deps, args.userEmail, rendered));
}

export function sendJoinRequestRejected(
  deps: EmailDeps,
  args: { chapter: Chapter; userEmail: string },
): Promise<void> {
  if (!args.userEmail) return Promise.resolve();
  const rendered = renderRequestRejected(deps.locale ?? "ja", {
    chapter: args.chapter,
    appUrl: deps.env.APP_URL,
  });
  return fireAndForget(deps, dispatch(deps, args.userEmail, rendered));
}

export function sendMemberLeft(
  deps: EmailDeps,
  args: { chapter: Chapter; formerMember: UserSummary; organizerEmails: string[] },
): Promise<void> {
  if (args.organizerEmails.length === 0) return Promise.resolve();
  const rendered = renderMemberLeft(deps.locale ?? "ja", {
    chapter: args.chapter,
    formerMember: args.formerMember,
    appUrl: deps.env.APP_URL,
  });
  return fireAndForget(deps, dispatch(deps, args.organizerEmails, rendered));
}

// Exposed for unit testing the renderers without a network call.
export const __renderers = {
  requestSubmitted: renderRequestSubmitted,
  requestApproved: renderRequestApproved,
  requestRejected: renderRequestRejected,
  memberLeft: renderMemberLeft,
};
