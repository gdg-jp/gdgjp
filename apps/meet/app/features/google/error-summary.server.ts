import { GoogleApiError } from "./client.server";
import { GoogleConnectionError } from "./token.server";

/** 外部へ表示・ログ出力可能な安全なエラー要約へ整形する（トークン・機密を含めない）。 */
export function toSafeErrorSummary(error: unknown): string {
  if (error instanceof GoogleConnectionError) {
    return error.message.slice(0, 240);
  }
  if (error instanceof GoogleApiError) {
    const statusLabel = error.apiStatus
      ? `${error.httpStatus} ${error.apiStatus}`
      : String(error.httpStatus);
    return `Google API エラー (${statusLabel}): ${error.apiMessage}`.slice(0, 240);
  }
  if (error instanceof Error) {
    return error.message.slice(0, 240);
  }
  return "予期しないエラーが発生しました";
}
