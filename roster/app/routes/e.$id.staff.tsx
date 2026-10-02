import { useEffect, useMemo, useState } from "react";
import {
  getApplicationByEventAndEmail,
  getApplicationById,
  withdrawApplication,
} from "~/features/applications/applications.server";
import { ProxyAddDialog } from "~/features/applications/components/ProxyAddDialog";
import { StaffDrawer } from "~/features/applications/components/StaffDrawer";
import { StaffTable } from "~/features/applications/components/StaffTable";
import {
  parseAvailabilityFromForm,
  parseSkillsFromForm,
} from "~/features/applications/form-fields";
import { saveOwnerRegistration } from "~/features/applications/owner-registration.server";
import { getPublicApplyData } from "~/features/applications/public-apply-data.server";
import { buildLiveStaffView } from "~/features/applications/staff-view";
import { DEFAULT_PARTY, type PartyStatus } from "~/features/applications/types";
import { validateApplyForm } from "~/features/applications/validate";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { canEditApplication, canManageEvent } from "~/features/auth/permissions";
import { ApplyLinkCard } from "~/features/events/components/ApplyLinkCard";
import { getEvent, updateEventSettings } from "~/features/events/events.server";
import { canApply, isEventStatus } from "~/features/events/status";
import { ShortageSummary } from "~/features/supply/components/ShortageSummary";
import { SupplyDemandRow } from "~/features/supply/components/SupplyDemandRow";
import { summarizeShortages } from "~/features/supply/supply";
import {
  getSupplyDemandForEvent,
  listEventApplicantDetails,
} from "~/features/supply/supply.server";
import { getDb } from "~/lib/db.server";
import type { Route } from "./+types/e.$id.staff";

/**
 * `/e/:id/staff` (docs/roster/05-staff-supply-demand.md "Design" §2-§4):
 * Chapter-gated, same access pattern as `/e/:id/design`. Stage 04 built only
 * the proxy-add entry point; Stage 05 adds the staff list (`StaffTable`),
 * owner-correction drawer (`StaffDrawer`), the supply-demand view
 * (`SupplyDemandRow`/`ShortageSummary`), and the apply-URL/status card
 * (`ApplyLinkCard`). No new route — every addition is new loader/action
 * surface on this same URL.
 */
// Deliberately loose — a sanity check against typos, not RFC 5322
// validation. Don't tighten this without checking real-world addresses it'd
// reject; accounts.gdgs.jp is the actual source of truth for whether an
// address is real (this route only decides whether it looks well-formed
// enough to store).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCHEDULE_CHANGED_ERROR =
  "シフト表が更新されたため保存できませんでした。画面を再読み込みして、もう一度お試しください。";

async function requireStaffAccess(env: Env, request: Request, id: string | undefined) {
  const { chapters } = await requireUserWithChapter(env, request);
  if (!id) throw new Response(null, { status: 404 });
  const event = await getEvent(getDb(env), id);
  if (!event) throw new Response(null, { status: 404 });
  if (!canManageEvent(chapters, event)) throw new Response("Forbidden", { status: 403 });
  return { event, chapters };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.event.name} — 募集・スタッフ — roster` : "roster" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { event } = await requireStaffAccess(env, request, params.id);
  const db = getDb(env);
  const [publicApplyData, applicantDetails] = await Promise.all([
    getPublicApplyData(db, event.id),
    listEventApplicantDetails(db, event.id),
  ]);
  const availableRoles = publicApplyData.roles;
  const rosterSheets = publicApplyData.rosterSheets;
  const timeSlots = rosterSheets.flatMap((sheet) => sheet.timeSlots);
  const { staff, staffDetails } = buildLiveStaffView(
    applicantDetails,
    availableRoles,
    timeSlots.map((slot) => slot.id),
  );
  const registeredCount = applicantDetails.filter((d) => !d.application.withdrawn).length;

  // Reuse applicant details so each sheet's supply query does not re-fetch applicants.
  const supplyDataBySheet = await Promise.all(
    rosterSheets.map(async (sheet) => {
      const supplyDemand = await getSupplyDemandForEvent(db, event.id, applicantDetails, sheet.id);
      const supplyBySlot = new Map(supplyDemand.map((entry) => [entry.timeSlotId, entry]));
      return {
        id: sheet.id,
        name: sheet.name,
        date: sheet.date,
        rows: sheet.timeSlots.map((slot) => ({
          label: `${slot.start}–${slot.end}`,
          phaseName: slot.phaseName,
          slot: supplyBySlot.get(slot.id) ?? {
            timeSlotId: slot.id,
            need: 0,
            available: 0,
            tight: [],
          },
        })),
        demand: supplyDemand,
      };
    }),
  );
  const shortageSummary = summarizeShortages(supplyDataBySheet.flatMap((group) => group.demand));
  const supplyGroups = supplyDataBySheet.map((group) => ({
    id: group.id,
    name: group.name,
    date: group.date,
    rows: group.rows,
  }));

  return {
    event: { id: event.id, name: event.name, hasParty: event.hasParty, status: event.status },
    applyUrl: `${env.APP_URL}/apply/${event.applyToken}`,
    canApplyNow: canApply(event.status),
    roles: availableRoles,
    rosterSheets,
    timeSlots,
    staff,
    staffDetails,
    registeredCount,
    supplyGroups,
    shortageSummary,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { event, chapters } = await requireStaffAccess(env, request, params.id);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "correct" || intent === "withdraw") {
    const applicationId = String(form.get("applicationId") ?? "");
    const existing = await getApplicationById(db, event.id, applicationId);
    if (!existing) throw new Response(null, { status: 404 });
    // Always true here in practice (this whole route already required
    // canManageEvent above), but routes the check through the single point
    // of permission judgment (docs/roster/index.md §6) rather than assuming
    // the earlier gate covers every future caller of this branch.
    if (!canEditApplication(null, chapters, event, existing)) {
      throw new Response("Forbidden", { status: 403 });
    }

    if (intent === "withdraw") {
      await withdrawApplication(db, existing.id, "owner");
      return { ok: true, intent: "withdraw" as const };
    }

    const { roles, rosterSheets } = await getPublicApplyData(db, event.id);
    const eventRoleIds = roles.map((role) => role.id);
    const timeSlotIds = rosterSheets.flatMap((sheet) => sheet.timeSlots.map((slot) => slot.id));
    const skills = parseSkillsFromForm(form, eventRoleIds);
    const availability = parseAvailabilityFromForm(form, timeSlotIds);

    const errors = validateApplyForm(
      {
        name: existing.name,
        contact: existing.contact ?? "",
        party: existing.party,
        note: existing.note ?? "",
        skills,
        availability,
      },
      {
        hasParty: event.hasParty,
        allowedRoleIds: new Set(eventRoleIds),
        timeSlotIds: new Set(timeSlotIds),
      },
    );
    if (errors.length > 0) return { error: errors[0], intent: "correct" as const };

    try {
      const saved = await saveOwnerRegistration(db, {
        eventId: event.id,
        existingApplicationId: existing.id,
        expectedUserId: existing.userId,
        email: existing.email,
        name: existing.name,
        contact: existing.contact,
        party: existing.party,
        note: existing.note,
        skills,
        liveRoleIds: eventRoleIds,
        availability,
      });
      if (!saved.ok) return { error: "既に登録されています。", intent: "correct" as const };
    } catch {
      return {
        error: SCHEDULE_CHANGED_ERROR,
        intent: "correct" as const,
      };
    }
    return { ok: true, intent: "correct" as const };
  }

  if (intent === "updateStatus") {
    const status = String(form.get("status") ?? "");
    if (!isEventStatus(status)) {
      return { error: "不明なステータスです。", intent: "updateStatus" as const };
    }
    // updateEventSettings overwrites the whole settings row — pass the
    // event's current stepMin/maxConsecutive/noSoloNewcomer through
    // unchanged so this status-only submit can't clobber them (same
    // "preserve what this form doesn't own" rule `correctApplication`
    // follows for name/contact/party/note).
    await updateEventSettings(db, event.id, {
      stepMin: event.stepMin,
      status,
      maxConsecutive: event.maxConsecutive,
      noSoloNewcomer: event.noSoloNewcomer,
    });
    return { ok: true, intent: "updateStatus" as const };
  }

  if (intent !== "proxyAdd") return { error: "不明な操作です。", intent: "unknown" as const };

  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const contactInput = String(form.get("contact") ?? "").trim();
  const party = String(form.get("party") ?? DEFAULT_PARTY) as PartyStatus;
  const note = String(form.get("note") ?? "").trim();

  if (!EMAIL_RE.test(email)) {
    return { error: "メールアドレスの形式が正しくありません。", intent: "proxyAdd" as const };
  }

  const { roles, rosterSheets } = await getPublicApplyData(db, event.id);
  const eventRoleIds = roles.map((role) => role.id);
  const timeSlotIds = rosterSheets.flatMap((sheet) => sheet.timeSlots.map((slot) => slot.id));
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
  if (errors.length > 0) return { error: errors[0], intent: "proxyAdd" as const };

  const contact = contactInput || email;
  const resolvedParty: PartyStatus = event.hasParty ? party : "undecided";

  // Upsert by (event, email) — ADR-008's "代理登録のみ user_id が NULL"
  // dedup key. A second proxyAdd for the same email edits that row
  // (owner-vs-owner or owner-vs-self, "最後に書いた側が勝つ") rather than
  // creating a duplicate; `userId` is left untouched either way.
  const existingByEmail = await getApplicationByEventAndEmail(db, event.id, email);
  try {
    const saved = await saveOwnerRegistration(db, {
      eventId: event.id,
      ...(existingByEmail ? { existingApplicationId: existingByEmail.id } : {}),
      expectedUserId: existingByEmail?.userId ?? null,
      email,
      name,
      contact,
      party: resolvedParty,
      note: note || null,
      skills,
      availability,
    });
    if (!saved.ok) return { error: "既に登録されています。", intent: "proxyAdd" as const };
  } catch {
    return {
      error: SCHEDULE_CHANGED_ERROR,
      intent: "proxyAdd" as const,
    };
  }

  return { ok: true, intent: "proxyAdd" as const };
}

export default function StaffPage({ loaderData, actionData }: Route.ComponentProps) {
  const {
    event,
    applyUrl,
    canApplyNow,
    roles,
    rosterSheets,
    staff,
    staffDetails,
    registeredCount,
    supplyGroups,
    shortageSummary,
  } = loaderData;
  const actionIntent = actionData && "intent" in actionData ? actionData.intent : undefined;
  const error = actionData && "error" in actionData ? actionData.error : undefined;
  // A fresh object only on an actual success — an error response is also a
  // truthy object, so a dialog can't tell "an action ran" from "the action
  // succeeded" without this being computed here.
  const succeeded = actionData && "ok" in actionData && actionData.ok ? actionData : undefined;

  const proxyError = actionIntent === "proxyAdd" ? error : undefined;
  const proxySucceeded = actionIntent === "proxyAdd" ? succeeded : undefined;
  const staffError = actionIntent === "correct" || actionIntent === "withdraw" ? error : undefined;
  const staffSucceeded =
    actionIntent === "correct" || actionIntent === "withdraw" ? succeeded : undefined;
  const statusError = actionIntent === "updateStatus" ? error : undefined;

  const roleNameById = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (staffSucceeded) setSelectedId(null);
  }, [staffSucceeded]);
  const selectedDetail = selectedId ? (staffDetails[selectedId] ?? null) : null;

  return (
    <main className="admin-page">
      <div className="page-heading">
        <div>
          <h1>スタッフ</h1>
          <p>{event.name} · 募集と登録状況</p>
        </div>
      </div>

      <ApplyLinkCard
        applyUrl={applyUrl}
        status={event.status}
        canApplyNow={canApplyNow}
        error={statusError}
      />

      <ShortageSummary
        registeredCount={registeredCount}
        shortages={shortageSummary}
        roleNameById={roleNameById}
      />

      <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-semibold">時間帯別の需給</h2>
        {supplyGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">回答できるシフト表がありません。</p>
        ) : (
          <div className="space-y-4">
            {supplyGroups.map((group) => (
              <section key={group.id} aria-labelledby={`supply-${group.id}`} className="space-y-2">
                <h3 id={`supply-${group.id}`} className="text-sm font-semibold">
                  {group.name} — {group.date}
                </h3>
                {group.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    このシフト表には時間枠がありません。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {group.rows.map((row) => (
                      <SupplyDemandRow
                        key={row.slot.timeSlotId}
                        slot={row.slot}
                        label={row.label}
                        phaseName={row.phaseName}
                        roleNameById={roleNameById}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">登録スタッフ</h2>
          <ProxyAddDialog
            hasParty={event.hasParty}
            roles={roles}
            rosterSheets={rosterSheets}
            error={proxyError}
            succeeded={proxySucceeded}
          />
        </div>
        <StaffTable rows={staff} hasParty={event.hasParty} onSelect={setSelectedId} />
      </section>

      <StaffDrawer
        detail={selectedDetail}
        roles={roles}
        rosterSheets={rosterSheets}
        error={staffError}
        succeeded={staffSucceeded}
        onClose={() => setSelectedId(null)}
      />
    </main>
  );
}
