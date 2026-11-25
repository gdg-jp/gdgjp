-- Deterministic fixture rows for the verify-connpass feature map.
-- Apply only to the disposable local D1 created by the verification helper, after
-- migrations and before the app starts serving. Every slug, ID, and value is fabricated.
-- No chapter-99 group is seeded: the outsider identity must stay without write access.
-- No Luma calendar is seeded: the Luma allowlist journey starts from the empty state.
-- Every job row is already terminal and is never sent to the queue, so the job runner
-- never executes it.

INSERT INTO groups (group_slug, group_id, chapter_id, enabled, created_at, updated_at)
VALUES
  ('verify-chapter10', 4242, '10', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('verify-disabled', NULL, '10', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('verify-adminonly', NULL, NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO jobs (
  id, type, status, group_slug, event_id, request_json, result_json, error, artifact_key,
  created_by, created_at, updated_at, started_at, finished_at
) VALUES
  ('vjob-chapter10', 'update_event', 'succeeded', 'verify-chapter10', '900001',
   '{"title":"Seeded title","body":"seeded body text","message":"seeded message text","artifactKey":"event-images/seeded"}',
   '{"eventId":"900001"}', NULL, NULL, 'seed-other-user',
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z',
   '2026-01-01T00:00:10.000Z', '2026-01-01T00:01:00.000Z'),
  ('vjob-disabled', 'publish_event', 'failed', 'verify-disabled', '900002',
   '{"postToTwitter":false}', NULL, 'seeded_failure', 'jobs/vjob-disabled/failure.png',
   'e2e-member-user',
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:02:00.000Z',
   '2026-01-01T00:00:10.000Z', '2026-01-01T00:02:00.000Z'),
  ('vjob-adminonly', 'copy_event', 'succeeded', 'verify-adminonly', '900003',
   '{}', '{"eventId":"900004"}', NULL, NULL, 'seed-other-user',
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:03:00.000Z',
   '2026-01-01T00:00:10.000Z', '2026-01-01T00:03:00.000Z');
