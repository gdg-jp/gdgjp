import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { isGoogleFormUrl } from "~/features/google/forms-utils";
import { createAccessContext } from "../../../shared/ingestion/domain";
import { createAndStartIngestion } from "../../../workers/features/ingestion/start-ingestion.server";

export const meta: MetaFunction = () => [{ title: "Analyze with AI (Beta) — GDG Japan Wiki" }];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = drizzle(env.DB, { schema });

  const driveToken = await db
    .select({ userId: schema.googleDriveTokens.userId })
    .from(schema.googleDriveTokens)
    .where(eq(schema.googleDriveTokens.userId, user.id))
    .get();

  return { driveConnected: !!driveToken };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context }: ActionFunctionArgs) {
  const { env, ctx } = context.cloudflare;
  const user = await requireUser(request, env);
  const identity = await getAccessIdentity(request, env);

  const formData = await request.formData();
  const googleFormUrl = String(formData.get("googleFormUrl") ?? "").trim();
  const eventTitle = String(formData.get("eventTitle") ?? "").trim();

  if (!googleFormUrl || !isGoogleFormUrl(googleFormUrl)) {
    return { errorKey: "analyze.errors.invalid_form_url" };
  }
  if (!eventTitle) {
    return { errorKey: "analyze.errors.event_title_required" };
  }

  const sessionId = nanoid();
  try {
    await createAndStartIngestion(env, ctx, {
      sessionId,
      userId: user.id,
      access: createAccessContext({
        userId: user.id,
        email: user.email,
        isAdmin: user.isAdmin,
        chapterIds: identity.user?.id === user.id ? identity.chapterIds : [],
        chapters: identity.user?.id === user.id ? identity.chapters : [],
        claimsAvailable: identity.user?.id === user.id && identity.claimsAvailable,
        source: "web",
      }),
      texts: [eventTitle],
      googleDocUrls: [],
      googleFormUrl,
      eventTitle,
      images: [],
      pdfs: [],
    });
  } catch (err) {
    console.error("analyze: failed to enqueue ingestion job", { sessionId, userId: user.id, err });
    return { errorKey: "analyze.errors.enqueue_failed" };
  }

  throw redirect(`/ingest/${sessionId}`);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalyzePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{t("analyze.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("analyze.description")}</p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <AnalyzeForm />
      </div>
    </div>
  );
}

function AnalyzeForm() {
  const { driveConnected } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();

  const [googleFormUrl, setGoogleFormUrl] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const serverError = actionData?.errorKey ? t(actionData.errorKey) : undefined;

  function validate(): string[] {
    const errs: string[] = [];
    if (!driveConnected) {
      errs.push(t("analyze.errors.form_not_connected"));
      return errs;
    }
    if (!googleFormUrl.trim()) {
      errs.push(t("analyze.errors.form_url_required"));
    } else if (!isGoogleFormUrl(googleFormUrl.trim())) {
      errs.push(t("analyze.errors.invalid_form_url"));
    }
    if (!eventTitle.trim()) {
      errs.push(t("analyze.errors.event_title_required"));
    }
    return errs;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const errs = validate();
    if (errs.length > 0) {
      e.preventDefault();
      setErrors(errs);
    }
  }

  const allErrors = serverError ? [serverError, ...errors] : errors;

  return (
    <form method="post" onSubmit={handleSubmit} className="space-y-6">
      {/* Errors */}
      {allErrors.length > 0 && (
        <div className="rounded-lg border border-danger bg-[var(--gdg-danger-surface)] p-4">
          <ul className="list-disc pl-4 text-sm text-danger">
            {allErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Connect Google prompt */}
      {!driveConnected && (
        <div className="rounded-lg border border-warning bg-[var(--gdg-warning-surface)] p-4">
          <p className="text-sm text-warning">{t("analyze.form.connect_hint")}</p>
          <a
            href="/api/google-drive/auth?returnTo=/analyze"
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-warning bg-surface px-3 py-2 text-sm font-medium text-warning transition-colors hover:bg-[var(--gdg-warning-surface)]"
          >
            {t("analyze.form.connect_google")}
          </a>
        </div>
      )}

      {/* Google Form URL */}
      <div>
        <label htmlFor="analyze-form-url" className="mb-1.5 block text-sm font-medium text-muted">
          {t("analyze.form.form_url_label")} <span className="text-danger">*</span>
        </label>
        <input
          id="analyze-form-url"
          type="url"
          name="googleFormUrl"
          value={googleFormUrl}
          onChange={(e) => setGoogleFormUrl(e.target.value)}
          placeholder="https://docs.google.com/forms/d/..."
          disabled={!driveConnected}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-neutral disabled:text-muted/70"
        />
      </div>

      {/* Event Title */}
      <div>
        <label
          htmlFor="analyze-event-title"
          className="mb-1.5 block text-sm font-medium text-muted"
        >
          {t("analyze.form.event_title_label")} <span className="text-danger">*</span>
        </label>
        <input
          id="analyze-event-title"
          type="text"
          name="eventTitle"
          value={eventTitle}
          onChange={(e) => setEventTitle(e.target.value)}
          placeholder={t("analyze.form.event_title_placeholder")}
          disabled={!driveConnected}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-neutral disabled:text-muted/70"
        />
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!driveConnected}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:bg-neutral disabled:text-muted"
        >
          {t("analyze.form.submit")}
        </button>
      </div>
    </form>
  );
}
