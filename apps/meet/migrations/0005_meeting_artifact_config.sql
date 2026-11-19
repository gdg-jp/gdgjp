ALTER TABLE meetings
  ADD COLUMN auto_transcription INTEGER NOT NULL DEFAULT 0 CHECK (auto_transcription IN (0, 1));
ALTER TABLE meetings
  ADD COLUMN auto_smart_notes INTEGER NOT NULL DEFAULT 0 CHECK (auto_smart_notes IN (0, 1));
ALTER TABLE meetings
  ADD COLUMN auto_recording INTEGER NOT NULL DEFAULT 0 CHECK (auto_recording IN (0, 1));
