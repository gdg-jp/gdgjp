export interface CheckInURLValidationResult {
  isValid: boolean;
}

/**
 * 受付QRコードURLを検証する関数
 * connpass: eventIdとgroupIdによるバリデーションを行う
 * luma: バリデーションなし
 */
export default function validateCheckInURL(
  qrText: string,
  eventId: string,
): CheckInURLValidationResult {
  // luma の場合
  if (qrText.startsWith("https://luma.com/check-in/")) {
    return {
      isValid: true,
    };
  }

  // connpassのQR受付用URLフォーマット判定用正規表現
  // 例: https://connpass.com/event/407324/qr_checkin/1010445/7173975/
  const CONNPASS_QR_REGEX = /^https?:\/\/connpass\.com\/event\/(\d+)\/qr_checkin\/(\d+)\/(\d+)\/?$/;

  const match = qrText.trim().match(CONNPASS_QR_REGEX);

  if (!match) {
    return { isValid: false };
  }

  // キャプチャグループから各IDを抽出（正規表現のカッコ順）
  const qrEventId = match[1]; // 407324 (イベントID)
  // const participantId = match[2]; // 1010445 (userId = participantId)
  // const extractedFrameId = match[3]; // 7173975 (受付番号)

  // 異なるイベントのQRコード
  if (qrEventId !== eventId) {
    return { isValid: false };
  }

  return {
    isValid: true,
  };
}
