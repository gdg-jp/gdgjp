interface CheckInResponse {
  checkedIn: boolean;
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
