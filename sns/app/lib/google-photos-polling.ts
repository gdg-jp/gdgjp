export const GOOGLE_PHOTOS_POLL_INTERVALS_MINUTES = [
  5, 10, 20, 40, 60, 120, 240, 480, 720, 1440,
] as const;

export const UNCHANGED_POLLS_PER_INTERVAL = 6;

export type GooglePhotosPollState = {
  intervalMinutes: number;
  unchangedPollCount: number;
};

export function nextGooglePhotosPollState(
  state: GooglePhotosPollState,
  changed: boolean,
): GooglePhotosPollState {
  if (changed)
    return { intervalMinutes: GOOGLE_PHOTOS_POLL_INTERVALS_MINUTES[0], unchangedPollCount: 0 };
  const unchangedPollCount = state.unchangedPollCount + 1;
  if (unchangedPollCount < UNCHANGED_POLLS_PER_INTERVAL) {
    return { intervalMinutes: state.intervalMinutes, unchangedPollCount };
  }
  const currentIndex = GOOGLE_PHOTOS_POLL_INTERVALS_MINUTES.indexOf(
    state.intervalMinutes as (typeof GOOGLE_PHOTOS_POLL_INTERVALS_MINUTES)[number],
  );
  const intervalMinutes =
    GOOGLE_PHOTOS_POLL_INTERVALS_MINUTES[
      Math.min(
        currentIndex < 0 ? 0 : currentIndex + 1,
        GOOGLE_PHOTOS_POLL_INTERVALS_MINUTES.length - 1,
      )
    ];
  return { intervalMinutes, unchangedPollCount: 0 };
}

export function nextGooglePhotosPollAt(intervalMinutes: number, now = Date.now()): string {
  return new Date(now + intervalMinutes * 60_000).toISOString();
}
