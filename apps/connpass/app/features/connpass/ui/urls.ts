export function groupHomeUrl(groupSlug: string): string {
  return `https://${groupSlug}.connpass.com/`;
}

export function groupEventsUrl(groupSlug: string): string {
  return `https://${groupSlug}.connpass.com/event/`;
}

export function eventEditUrl(eventId: string | number): string {
  return `https://connpass.com/event/${eventId}/edit/`;
}
