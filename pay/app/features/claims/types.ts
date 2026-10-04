export type ClaimRow = {
  id: string;
  event_id: string;
  kind: "self" | "proxy";
  user_id: string | null;
  applicant_name: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number_enc: string;
  application_date: string;
  total_amount: number;
  sheet_id: string | null;
  sheet_url: string | null;
  drive_folder_id: string | null;
  email_sent_at: number | null;
  status: "draft" | "synced";
  created_by: string;
  created_at: number;
  updated_at: number;
};

export type ClaimItemRow = {
  id: string;
  claim_id: string;
  spent_on: string;
  category: string;
  description: string;
  amount_yen: number;
  receipt_r2_key: string | null;
  receipt_filename: string | null;
  receipt_content_type: string | null;
  receipt_drive_file_id: string | null;
  extraction_json: string | null;
  sort_order: number;
  created_at: number;
};
