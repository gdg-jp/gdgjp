export type GooglePhotosAlbum = {
  id: string;
  chapterId: number;
  albumUrl: string;
  enabled: boolean;
  pollIntervalMinutes: number;
  unchangedPollCount: number;
  nextPollAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type GooglePhotosLibraryMedia = {
  id: string;
  stablePhotoId: string;
  blurhash: string | null;
  contentType: string;
  byteSize: number;
  takenAt: string | null;
  importedAt: string;
};

export type GooglePhotosPollRun = {
  id: string;
  startedAt: string;
  outcome: string;
  importedCount: number;
  detail: string | null;
};
