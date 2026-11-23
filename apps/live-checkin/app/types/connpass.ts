interface CheckInResponse {
  checkedIn: boolean;
  userId: string | null;
  reason: "already_checked_in" | "failed" | "error" | (string & {}) | null;
  promoCode?: string | null;
}

interface EventSummary {
  id: string;
  url: string;
  editUrl: string;
  status: "draft" | "published" | "canceled";
  title: string;
  startAt: string;
  endAt: string;
  place?: string | null;
  participantsCount?: number | null;
}
