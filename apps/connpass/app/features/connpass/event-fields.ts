export type ParticipationType = {
  id?: string;
  name?: string;
  maxParticipants?: number;
  feeType?: "prepay" | "place";
  fee?: number;
  method?: "fcfs" | "lottery";
  subEventIds?: string[] | null;
};

export function parseParticipationTypes(value: unknown): ParticipationType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const types: ParticipationType[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const type: ParticipationType = {};
    if (typeof item.name === "string") type.name = item.name;
    if (typeof item.maxParticipants === "number") type.maxParticipants = item.maxParticipants;
    if (item.feeType === "prepay" || item.feeType === "place") type.feeType = item.feeType;
    if (typeof item.fee === "number") type.fee = item.fee;
    if (item.method === "fcfs" || item.method === "lottery") type.method = item.method;
    types.push(type);
  }
  return types;
}

export type EventEditFields = {
  title?: string;
  subtitle?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  place?: string;
  address?: string;
  capacity?: number;
  reservedAt?: string;
  registrationEnabled?: boolean;
  participationTypes?: ParticipationType[];
  ownerText?: string;
  participantOnlyInfo?: string;
  cancelPolicy?: string;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  lotteryPublishDate?: string | null;
  allowConflictJoin?: boolean;
  checkinCode?: string;
  hashtag?: string;
  organizerIds?: string[];
  speakerTitle?: string;
  speakerIds?: string[];
  paypalEmail?: string;
  contactDetails?: string;
  allowReceipt?: boolean;
  invoiceNumber?: string;
  receiptIssuerName?: string;
  receiptIssuerAddress?: string;
};

const eventWriteFieldNames = [
  "title",
  "subtitle",
  "description",
  "startAt",
  "endAt",
  "place",
  "address",
  "capacity",
  "reservedAt",
  "registrationEnabled",
  "participationTypes",
  "ownerText",
  "participantOnlyInfo",
  "cancelPolicy",
  "registrationOpenAt",
  "registrationCloseAt",
  "lotteryPublishDate",
  "allowConflictJoin",
  "checkinCode",
  "hashtag",
  "organizerIds",
  "speakerTitle",
  "speakerIds",
  "paypalEmail",
  "contactDetails",
  "allowReceipt",
  "invoiceNumber",
  "receiptIssuerName",
  "receiptIssuerAddress",
] as const;

/**
 * Keep HTTP writes and the Browser Run job on the same, deliberately small
 * contract. Connpass exposes additional read-only or file-upload-only fields;
 * accepting those here would otherwise create successful no-op jobs.
 */
export function parseEventWriteFields(
  body: Record<string, unknown>,
): { fields: EventEditFields } | { error: string } {
  const unsupported = Object.keys(body).filter(
    (key) => !eventWriteFieldNames.includes(key as (typeof eventWriteFieldNames)[number]),
  );
  if (unsupported.length > 0) return { error: `unsupported_event_fields:${unsupported.join(",")}` };

  const stringFields = [
    "title",
    "subtitle",
    "description",
    "startAt",
    "endAt",
    "place",
    "address",
    "reservedAt",
    "ownerText",
    "participantOnlyInfo",
    "cancelPolicy",
    "registrationOpenAt",
    "registrationCloseAt",
    "lotteryPublishDate",
    "checkinCode",
    "hashtag",
    "speakerTitle",
    "paypalEmail",
    "contactDetails",
    "invoiceNumber",
    "receiptIssuerName",
    "receiptIssuerAddress",
  ] as const;
  const invalid: string[] = stringFields.filter(
    (key) => body[key] !== undefined && typeof body[key] !== "string",
  );
  if (
    body.capacity !== undefined &&
    (typeof body.capacity !== "number" || !Number.isFinite(body.capacity))
  ) {
    invalid.push("capacity");
  }
  if (body.registrationEnabled !== undefined && typeof body.registrationEnabled !== "boolean") {
    invalid.push("registrationEnabled");
  }
  for (const key of ["allowConflictJoin", "allowReceipt"] as const) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") invalid.push(key);
  }
  for (const key of ["organizerIds", "speakerIds"] as const) {
    if (
      body[key] !== undefined &&
      (!Array.isArray(body[key]) || !body[key].every((v) => typeof v === "string"))
    ) {
      invalid.push(key);
    }
  }
  if (body.participationTypes !== undefined && !Array.isArray(body.participationTypes)) {
    invalid.push("participationTypes");
  }
  if (invalid.length > 0) return { error: `invalid_event_fields:${invalid.join(",")}` };

  return {
    fields: {
      title: typeof body.title === "string" ? body.title : undefined,
      subtitle: typeof body.subtitle === "string" ? body.subtitle : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      startAt: typeof body.startAt === "string" ? body.startAt : undefined,
      endAt: typeof body.endAt === "string" ? body.endAt : undefined,
      place: typeof body.place === "string" ? body.place : undefined,
      address: typeof body.address === "string" ? body.address : undefined,
      capacity: typeof body.capacity === "number" ? body.capacity : undefined,
      reservedAt: typeof body.reservedAt === "string" ? body.reservedAt : undefined,
      registrationEnabled:
        typeof body.registrationEnabled === "boolean" ? body.registrationEnabled : undefined,
      participationTypes: parseParticipationTypes(body.participationTypes),
      ownerText: typeof body.ownerText === "string" ? body.ownerText : undefined,
      participantOnlyInfo:
        typeof body.participantOnlyInfo === "string" ? body.participantOnlyInfo : undefined,
      cancelPolicy: typeof body.cancelPolicy === "string" ? body.cancelPolicy : undefined,
      registrationOpenAt:
        typeof body.registrationOpenAt === "string" ? body.registrationOpenAt : undefined,
      registrationCloseAt:
        typeof body.registrationCloseAt === "string" ? body.registrationCloseAt : undefined,
      lotteryPublishDate:
        typeof body.lotteryPublishDate === "string" ? body.lotteryPublishDate : undefined,
      allowConflictJoin:
        typeof body.allowConflictJoin === "boolean" ? body.allowConflictJoin : undefined,
      checkinCode: typeof body.checkinCode === "string" ? body.checkinCode : undefined,
      hashtag: typeof body.hashtag === "string" ? body.hashtag : undefined,
      organizerIds: Array.isArray(body.organizerIds) ? (body.organizerIds as string[]) : undefined,
      speakerTitle: typeof body.speakerTitle === "string" ? body.speakerTitle : undefined,
      speakerIds: Array.isArray(body.speakerIds) ? (body.speakerIds as string[]) : undefined,
      paypalEmail: typeof body.paypalEmail === "string" ? body.paypalEmail : undefined,
      contactDetails: typeof body.contactDetails === "string" ? body.contactDetails : undefined,
      allowReceipt: typeof body.allowReceipt === "boolean" ? body.allowReceipt : undefined,
      invoiceNumber: typeof body.invoiceNumber === "string" ? body.invoiceNumber : undefined,
      receiptIssuerName:
        typeof body.receiptIssuerName === "string" ? body.receiptIssuerName : undefined,
      receiptIssuerAddress:
        typeof body.receiptIssuerAddress === "string" ? body.receiptIssuerAddress : undefined,
    },
  };
}
