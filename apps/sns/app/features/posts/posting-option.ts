export type PostingOption = "immediate" | "scheduled" | "photo_required";

const POSTING_OPTION_COOKIE = "sns-posting-option";

export function postingOptionFromCookie(request: Request): PostingOption {
  const value = request.headers
    .get("Cookie")
    ?.match(new RegExp(`(?:^|; )${POSTING_OPTION_COOKIE}=([^;]+)`))?.[1];
  return value === "immediate" || value === "scheduled" || value === "photo_required"
    ? value
    : "photo_required";
}

export function postingOptionCookie(option: PostingOption): string {
  return `${POSTING_OPTION_COOKIE}=${option}; Path=/; SameSite=Lax; Max-Age=31536000; Secure`;
}
