ALTER TABLE pages ADD COLUMN organizer_role TEXT
  CHECK (organizer_role IN ('viewer', 'commenter', 'editor'));
ALTER TABLE pages ADD COLUMN member_role TEXT
  CHECK (member_role IN ('viewer', 'commenter', 'editor'));
