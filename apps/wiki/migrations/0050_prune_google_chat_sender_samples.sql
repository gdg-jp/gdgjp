-- Cap retained Google Chat sender samples at 10 per resource_name.
DELETE FROM google_chat_sender_samples
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY resource_name ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM google_chat_sender_samples
  ) WHERE rn <= 10
);
