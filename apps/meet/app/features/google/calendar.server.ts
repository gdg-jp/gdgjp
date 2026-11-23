import { type GoogleFetch, googleJsonRequest } from "~/features/google/client.server";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export type CalendarSendUpdates = "all" | "externalOnly" | "none";

export function attendeeUpdates(env: { CALENDAR_SEND_UPDATES?: string }): CalendarSendUpdates {
  return env.CALENDAR_SEND_UPDATES === "none" ? "none" : "all";
}

export type CalendarDateTime = {
  dateTime: string;
  timeZone?: string;
};

export type CalendarAttendee = {
  email: string;
  displayName?: string;
  responseStatus?: string;
};

export type CalendarAttachment = {
  fileUrl: string;
  title: string;
  mimeType: string;
  fileId?: string;
};

export type CalendarConferenceData = {
  conferenceSolution?: { key: { type: "hangoutsMeet" } };
  entryPoints?: Array<{
    entryPointType: "video";
    uri: string;
    label?: string;
  }>;
};

export type CalendarEventBody = {
  summary?: string;
  description?: string;
  start?: CalendarDateTime;
  end?: CalendarDateTime;
  attendees?: CalendarAttendee[];
  guestsCanSeeOtherGuests?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  conferenceData?: CalendarConferenceData;
  extendedProperties?: {
    private?: Record<string, string>;
  };
  attachments?: CalendarAttachment[];
};

export type CalendarEvent = CalendarEventBody & {
  id: string;
  htmlLink?: string;
  status?: string;
};

export async function insertEvent(
  accessToken: string,
  options: {
    calendarId?: string;
    conferenceDataVersion?: number;
    sendUpdates?: CalendarSendUpdates;
    supportsAttachments?: boolean;
    body: CalendarEventBody;
  },
  fetchFn?: GoogleFetch,
): Promise<CalendarEvent> {
  const calendarId = options.calendarId ?? "primary";
  const params = new URLSearchParams();
  params.set("conferenceDataVersion", String(options.conferenceDataVersion ?? 1));
  if (options.sendUpdates) params.set("sendUpdates", options.sendUpdates);
  if (options.supportsAttachments) params.set("supportsAttachments", "true");

  return googleJsonRequest<CalendarEvent>({
    accessToken,
    method: "POST",
    url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    body: options.body,
    fetchFn,
  });
}

export async function getEvent(
  accessToken: string,
  options: { calendarId?: string; eventId: string },
  fetchFn?: GoogleFetch,
): Promise<CalendarEvent> {
  const calendarId = options.calendarId ?? "primary";
  return googleJsonRequest<CalendarEvent>({
    accessToken,
    method: "GET",
    url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(options.eventId)}`,
    fetchFn,
  });
}

export async function patchEvent(
  accessToken: string,
  options: {
    calendarId?: string;
    eventId: string;
    sendUpdates?: CalendarSendUpdates;
    supportsAttachments?: boolean;
    body: CalendarEventBody;
  },
  fetchFn?: GoogleFetch,
): Promise<CalendarEvent> {
  const calendarId = options.calendarId ?? "primary";
  const params = new URLSearchParams();
  if (options.sendUpdates) params.set("sendUpdates", options.sendUpdates);
  if (options.supportsAttachments) params.set("supportsAttachments", "true");
  const query = params.toString();
  const base = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(options.eventId)}`;

  return googleJsonRequest<CalendarEvent>({
    accessToken,
    method: "PATCH",
    url: query ? `${base}?${query}` : base,
    body: options.body,
    fetchFn,
  });
}

export async function deleteEvent(
  accessToken: string,
  options: { calendarId?: string; eventId: string; sendUpdates?: CalendarSendUpdates },
  fetchFn?: GoogleFetch,
): Promise<void> {
  const calendarId = options.calendarId ?? "primary";
  const params = new URLSearchParams();
  if (options.sendUpdates) params.set("sendUpdates", options.sendUpdates);
  const query = params.toString();
  const base = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(options.eventId)}`;

  await googleJsonRequest<unknown>({
    accessToken,
    method: "DELETE",
    url: query ? `${base}?${query}` : base,
    fetchFn,
  });
}
