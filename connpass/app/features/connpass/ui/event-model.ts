/**
 * Parses the JSON model dump connpass embeds on every `/event/<id>/edit/` page load:
 * `model: new Models.Event({...}, {parse: true})`. This is a far more reliable data
 * source than scraping individual DOM fields — confirmed present in every
 * `event-edit*.html` fixture (see fixtures/html/README.md).
 */
export type ConnpassEventModel = {
  id: number;
  title: string;
  series: number | null;
  sub_title: string;
  description_input: string;
  description: string;
  hashtag: string;
  max_num: number | null;
  participants_count: number;
  waitlist_count: number;
  cancelled_count: number;
  checkin_code: string | null;
  status: string;
  event_type: string;
  public_url: string;
  participation_types: Array<{
    id: number;
    name: string;
    max_participants: number | null;
    join_fee: number | null;
    place_fee: number | null;
    method: string;
  }>;
  has_children: boolean;
  owner_text: string;
  image: string | null;
  allow_conflict_join: boolean;
  start_datetime: string | null;
  end_datetime: string | null;
  open_start_datetime: string | null;
  open_end_datetime: string | null;
  publish_datetime: string | null;
  lottery_publish_date: string | null;
  place: { name?: string; address?: string } | string | null;
  cancel_policy: string;
  allow_receipt: boolean;
  paypal_email: string;
  contact_details: string;
  receipt_issuer_name: string;
  receipt_issuer_address: string;
  invoice_number: string;
  participant_only_info: string;
  presenter_title: string;
};

const MODEL_PREFIX = "new Models.Event(";

/**
 * Brace-matching extraction (not a single regex) because the model JSON itself
 * contains nested `}` inside `participation_types` objects.
 */
export function parseEventModel(html: string): ConnpassEventModel | null {
  const start = html.indexOf(MODEL_PREFIX);
  if (start === -1) return null;
  const jsonStart = start + MODEL_PREFIX.length;
  if (html[jsonStart] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let end = -1;
  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;

  const jsonText = html.slice(jsonStart, end);
  try {
    return JSON.parse(jsonText) as ConnpassEventModel;
  } catch {
    return null;
  }
}

export function mapEventStatus(raw: string): "draft" | "published" | "canceled" {
  if (raw === "draft") return "draft";
  // "public" = currently accepting registration; "ended" = published event
  // whose end_datetime has passed (subevent-published.html). Both map to the
  // OpenAPI enum's single "published" value, which doesn't distinguish past/future.
  if (raw === "public" || raw === "ended") return "published";
  // No fixture captures the cancelled literal; connpass's own naming convention
  // ("中止" = cancel) makes "cancel"/"cancelled" the likeliest values here.
  return "canceled";
}
