-- Optional owner-defined custom slug for public image URLs.
-- img.gdgs.jp/<slug> resolves to the same image as img.gdgs.jp/<id>.
ALTER TABLE images ADD COLUMN slug TEXT;

-- Uniqueness enforced only for rows that actually set a slug.
CREATE UNIQUE INDEX idx_images_slug ON images(slug) WHERE slug IS NOT NULL;
