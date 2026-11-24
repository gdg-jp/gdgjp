INSERT INTO events (id, title, description, slot_minutes, owner_user_id)
VALUES (
  'evt_0VERFYSCHEDXFRGN0000000001',
  'Verify foreign event',
  'Seeded for scheduler verification.',
  60,
  'dev-user-verify-other'
);

INSERT INTO event_slots (id, event_id, day_of_week, start_time) VALUES
  (9101, 'evt_0VERFYSCHEDXFRGN0000000001', 0, '19:00'),
  (9102, 'evt_0VERFYSCHEDXFRGN0000000001', 0, '20:00'),
  (9103, 'evt_0VERFYSCHEDXFRGN0000000001', 1, '19:00');

INSERT INTO event_participants (id, event_id, user_id, display_name, edit_token_hash) VALUES
  (
    9201,
    'evt_0VERFYSCHEDXFRGN0000000001',
    NULL,
    'Seed Guest',
    '8a7eab88d92938715211e1749d8a0bd41cca5835b56166f432a0cafca42de8a7'
  ),
  (9202, 'evt_0VERFYSCHEDXFRGN0000000001', 'dev-user-verify-other', 'verify-other (dev)', NULL);

INSERT INTO event_availabilities (participant_id, slot_id) VALUES
  (9201, 9101),
  (9202, 9101),
  (9202, 9102);

INSERT INTO events (id, title, description, slot_minutes, owner_user_id, deleted_at)
VALUES (
  'evt_0VERFYSCHEDXGNE00000000002',
  'Verify deleted event',
  NULL,
  60,
  'dev-user-verify-owner',
  unixepoch()
);

INSERT INTO event_slots (id, event_id, day_of_week, start_time) VALUES
  (9111, 'evt_0VERFYSCHEDXGNE00000000002', 2, '10:00');
