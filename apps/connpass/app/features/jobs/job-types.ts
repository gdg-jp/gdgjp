export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobType =
  | "create_event"
  | "update_event"
  | "publish_event"
  | "create_sub_event"
  | "delete_sub_event"
  | "upsert_survey"
  | "upsert_conference"
  | "upload_event_image"
  | "copy_event"
  | "delete_event_draft"
  | "cancel_event"
  | "update_participant"
  | "send_event_message"
  | "create_voucher_recipient"
  | "update_voucher_recipient"
  | "delete_voucher_recipient"
  | "relogin";

export type JobRecord = {
  id: string;
  type: JobType;
  status: JobStatus;
  groupSlug: string;
  eventId: string | null;
  requestJson: string;
  resultJson: string | null;
  error: string | null;
  artifactKey: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type JobQueueMessage = {
  jobId: string;
};

export type NewJobInput = {
  type: JobType;
  groupSlug: string;
  eventId?: string | null;
  request: unknown;
  createdBy: string;
};
