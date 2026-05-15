import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import * as schema from "~/db/schema";
import { requireUser } from "~/lib/auth-utils.server";
import { isGoogleFormUrl } from "~/lib/google-forms-utils";
import { buildIngestionQueueMessage } from "~/lib/ingestion-jobs.server";
import type { IngestionInputs } from "~/lib/ingestion-pipeline.server";
import { sendOrRunIngestion } from "~/lib/queue-processors.server";

export const meta: MetaFunction = () => [{ title: "Analyze with AI (Beta) — GDGoC Japan Wiki" }];

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
  const db = drizzle(env.DB, { schema });

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
  const inputs: IngestionInputs = {
    texts: [eventTitle],
    imageKeys: [],
    googleDocUrls: [],
    googleFormUrl,
    eventTitle,
  };

  await db.insert(schema.ingestionSessions).values({
    id: sessionId,
    userId: user.id,
    status: "processing",
    inputsJson: JSON.stringify({
      texts: inputs.texts,
      imageKeys: [],
      googleDocUrls: [],
      googleFormUrl,
      eventTitle,
    }),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    await sendOrRunIngestion(env, ctx, buildIngestionQueueMessage(sessionId, user.id, "initial"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("analyze: failed to enqueue ingestion job", { sessionId, userId: user.id, err });
    await db
      .update(schema.ingestionSessions)
      .set({
        status: "error",
        errorMessage: `Queue enqueue failed: ${message}`,
        phaseMessage: "queue_enqueue_failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.ingestionSessions.id, sessionId),
          eq(schema.ingestionSessions.userId, user.id),
        ),
      );
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
        <h1 className="text-2xl font-bold text-gray-900">{t("analyze.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("analyze.description")}</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <ul className="list-disc pl-4 text-sm text-red-700">
            {allErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Connect Google prompt */}
      {!driveConnected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{t("analyze.form.connect_hint")}</p>
          <a
            href="/api/google-drive/auth?returnTo=/analyze"
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            {t("analyze.form.connect_google")}
          </a>
        </div>
      )}

      {/* Google Form URL */}
      <div>
        <label
          htmlFor="analyze-form-url"
          className="mb-1.5 block text-sm font-medium text-gray-700"
        >
          {t("analyze.form.form_url_label")} <span className="text-red-500">*</span>
        </label>
        <input
          id="analyze-form-url"
          type="url"
          name="googleFormUrl"
          value={googleFormUrl}
          onChange={(e) => setGoogleFormUrl(e.target.value)}
          placeholder="https://docs.google.com/forms/d/..."
          disabled={!driveConnected}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
        />
      </div>

      {/* Event Title */}
      <div>
        <label
          htmlFor="analyze-event-title"
          className="mb-1.5 block text-sm font-medium text-gray-700"
        >
          {t("analyze.form.event_title_label")} <span className="text-red-500">*</span>
        </label>
        <input
          id="analyze-event-title"
          type="text"
          name="eventTitle"
          value={eventTitle}
          onChange={(e) => setEventTitle(e.target.value)}
          placeholder={t("analyze.form.event_title_placeholder")}
          disabled={!driveConnected}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
        />
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!driveConnected}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:text-gray-500"
        >
          {t("analyze.form.submit")}
        </button>
      </div>
    </form>
  );
}
