import { Badge, Button, Card, Stack } from "@gdgjp/design-system";
import { PublicShell } from "~/components/PublicShell";
import {
  resolveOwnApplication,
  withdrawApplication,
} from "~/features/applications/applications.server";
import { ApplyForm, type ApplyFormOwn } from "~/features/applications/components/ApplyForm";
import { listEventAvailabilityForApplication } from "~/features/applications/event-availability.server";
import {
  parseAvailabilityFromForm,
  parseSkillsFromForm,
} from "~/features/applications/form-fields";
import { getPublicApplyData } from "~/features/applications/public-apply-data.server";
import { saveSelfRegistration } from "~/features/applications/self-registration.server";
import { listSkillsForApplication } from "~/features/applications/skills.server";
import { DEFAULT_PARTY, type PartyStatus } from "~/features/applications/types";
import { validateApplyForm } from "~/features/applications/validate";
import { buildSignInRedirect, getOptionalUser } from "~/features/auth/auth-redirect.server";
import { getEventByApplyToken } from "~/features/events/events.server";
import { canApply } from "~/features/events/status";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/apply.$token";

/**
 * `/apply/:token` (docs/roster/04-applications.md "Design" §2, §5): the
 * public staff-registration form. Gated on `getOptionalUser` — never
 * `requireUserWithChapter` — because Chapter membership must not be
 * required to register as staff. Event lookup is by `apply_token` alone;
 * the event id never appears in this URL.
 *
 * The loader's return value is the whole PII surface of this public route:
 * it must contain the event summary, the union of recruiting roles, the live
 * sheet/time-slot groups, and *only the viewer's own* application/skills/availability — never
 * another applicant's name, email, contact, or skills. See
 * `apply.$token.test.ts` for a test that asserts this on the raw returned
 * object, not just on what the UI happens to render.
 */
export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.event.name} — スタッフ登録 — roster` : "roster" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const token = params.token;
  if (!token) throw new Response(null, { status: 404 });

  const db = getDb(env);
  const event = await getEventByApplyToken(db, token);
  if (!event) throw new Response(null, { status: 404 });

  const publicApplyData = await getPublicApplyData(db, event.id);

  const viewer = await getOptionalUser(env, request);
  const url = new URL(request.url);
  const signInHref = `/signin?return_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`;

  // Auto-claim happens on every signed-in view, deliberately not gated on
  // canApplyNow: claiming only attaches the viewer's identity to an existing
  // proxy row (ADR-008), it never lets them create or edit anything past
  // closed — the action below still blocks that. Linking the identity as
  // soon as they're seen is strictly more useful to the owner than making
  // them re-open the page while registration happens to be open again.
  let own: ApplyFormOwn | null = null;
  if (viewer) {
    const resolved = await resolveOwnApplication(db, event.id, {
      userId: viewer.id,
      email: viewer.email,
    });
    if (resolved.kind === "own") {
      const [skills, availability] = await Promise.all([
        listSkillsForApplication(db, resolved.application.id),
        listEventAvailabilityForApplication(db, resolved.application.id),
      ]);
      own = {
        name: resolved.application.name,
        contact: resolved.application.contact ?? "",
        party: resolved.application.party,
        note: resolved.application.note ?? "",
        withdrawn: resolved.application.withdrawn,
        skills: skills.map((s) => ({ roleId: s.roleId, level: s.level, pref: s.pref })),
        availability: availability.map((a) => ({ timeSlotId: a.timeSlotId, value: a.value })),
      };
    }
  }

  return {
    event: {
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      hasParty: event.hasParty,
      status: event.status,
    },
    canApplyNow: canApply(event.status),
    viewer: viewer ? { name: viewer.name, email: viewer.email } : null,
    signInHref,
    roles: publicApplyData.roles,
    rosterSheets: publicApplyData.rosterSheets,
    own,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const token = params.token;
  if (!token) throw new Response(null, { status: 404 });

  const db = getDb(env);
  const event = await getEventByApplyToken(db, token);
  if (!event) throw new Response(null, { status: 404 });

  // Never requireUserWithChapter here — Chapter membership must not gate
  // registering as staff. An unauthenticated write attempt (e.g. a stale
  // form after the session expired) redirects to sign-in instead of 403ing.
  const viewer = await getOptionalUser(env, request);
  if (!viewer) throw buildSignInRedirect(request);

  if (!canApply(event.status)) return { error: "募集は終了しました。" };

  // Resolve server-side from the viewer's identity — never trust a
  // client-submitted application id (docs/roster/04-applications.md
  // "Design" §4 "他人の application に書き込めないこと").
  const resolved = await resolveOwnApplication(db, event.id, {
    userId: viewer.id,
    email: viewer.email,
  });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  if (intent === "withdraw") {
    if (resolved.kind !== "own") return { error: "登録が見つかりません。" };
    await withdrawApplication(db, resolved.application.id, "self");
    return { ok: true };
  }

  const { roles, rosterSheets } = await getPublicApplyData(db, event.id);
  const eventRoleIds = roles.map((role) => role.id);
  const timeSlotIds = rosterSheets.flatMap((sheet) => sheet.timeSlots.map((slot) => slot.id));

  const name = String(form.get("name") ?? "").trim();
  const contactInput = String(form.get("contact") ?? "").trim();
  const party = String(form.get("party") ?? DEFAULT_PARTY) as PartyStatus;
  const note = String(form.get("note") ?? "").trim();
  const skills = parseSkillsFromForm(form, eventRoleIds);
  const availability = parseAvailabilityFromForm(form, timeSlotIds);

  const errors = validateApplyForm(
    { name, contact: contactInput, party, note, skills, availability },
    {
      hasParty: event.hasParty,
      allowedRoleIds: new Set(eventRoleIds),
      timeSlotIds: new Set(timeSlotIds),
    },
  );
  if (errors.length > 0) return { error: errors[0] };

  // "未入力ならアカウントのメールを使う" (docs/roster/04-applications.md
  // "Design" §2) — resolved once here so both create and update store the
  // same fallback rather than leaving it to be re-derived later.
  const contact = contactInput || viewer.email;
  const resolvedParty: PartyStatus = event.hasParty ? party : "undecided";

  try {
    const saved = await saveSelfRegistration(db, {
      eventId: event.id,
      userId: viewer.id,
      email: viewer.email,
      ...(resolved.kind === "own" ? { existingApplicationId: resolved.application.id } : {}),
      name,
      contact,
      party: resolvedParty,
      note: note || null,
      skills,
      availability,
    });
    if (!saved.ok) {
      return {
        error:
          saved.reason === "duplicate_email"
            ? "このメールアドレスは既に登録されています。"
            : "既に登録されています。",
      };
    }
  } catch {
    return {
      error:
        "シフト表が更新されたため保存できませんでした。画面を再読み込みして、もう一度お試しください。",
    };
  }

  return { ok: true };
}

export default function ApplyPage({ loaderData, actionData }: Route.ComponentProps) {
  const { event, canApplyNow, viewer, signInHref, roles, rosterSheets, own } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : undefined;

  return (
    <PublicShell>
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">スタッフ登録</h1>
        <p className="text-sm text-muted">
          {event.name}
          <span aria-hidden="true"> · </span>
          {event.date} {event.startTime}–{event.endTime}
        </p>
      </header>

      {!canApplyNow ? (
        <Card>
          <p className="font-medium">募集は終了しました。</p>
        </Card>
      ) : !viewer ? (
        <Card>
          <Stack>
            <p>このイベントはスタッフを募集しています。登録するにはサインインしてください。</p>
            {roles.length > 0 ? (
              <div>
                <h2 className="text-sm font-medium">募集中の役割</h2>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {roles.map((role) => (
                    <li key={role.id}>
                      <Badge tone="neutral">{role.name}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <Button asChild>
                <a href={signInHref}>サインインして登録する</a>
              </Button>
            </div>
          </Stack>
        </Card>
      ) : (
        <Card>
          <ApplyForm
            hasParty={event.hasParty}
            roles={roles}
            rosterSheets={rosterSheets}
            own={own}
            defaultName={viewer.name}
            error={error}
          />
        </Card>
      )}
    </PublicShell>
  );
}
