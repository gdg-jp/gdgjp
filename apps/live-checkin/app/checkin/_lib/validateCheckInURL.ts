export interface CheckInURLValidationResult {
  isValid: boolean;
}

export default function validateCheckInURL(
  qrText: string,
  eventId: string,
): CheckInURLValidationResult {
  if (qrText.startsWith("https://luma.com/check-in/")) {
    return {
      isValid: true,
    };
  }

  const CONNPASS_QR_REGEX = /^https?:\/\/connpass\.com\/event\/(\d+)\/qr_checkin\/(\d+)\/(\d+)\/?$/;

  const match = qrText.trim().match(CONNPASS_QR_REGEX);

  if (!match) {
    return { isValid: false };
  }

  const qrEventId = match[1];

  if (qrEventId !== eventId) {
    return { isValid: false };
  }

  return {
    isValid: true,
  };
}
