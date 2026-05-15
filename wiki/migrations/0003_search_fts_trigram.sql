-- Trigram-based FTS5 table for Japanese/CJK substring search
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts_trigram USING fts5(
  page_id  UNINDEXED,
  title_ja,
  title_en,
  summary_ja,
  summary_en,
  tags_text,
  tokenize = 'trigram'
);

-- Backfill from existing pages_fts
INSERT INTO pages_fts_trigram(page_id, title_ja, title_en, summary_ja, summary_en, tags_text)
SELECT pf.page_id, pf.title_ja, pf.title_en, pf.summary_ja, pf.summary_en, pf.tags_text
FROM pages_fts pf;

-- Sync triggers (mirror the existing pages_fts triggers)
CREATE TRIGGER IF NOT EXISTS pages_fts_trigram_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts_trigram(page_id, title_ja, title_en, summary_ja, summary_en, tags_text)
  VALUES (new.id, new.title_ja, new.title_en, new.summary_ja, new.summary_en, '');
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_trigram_update AFTER UPDATE ON pages BEGIN
  UPDATE pages_fts_trigram
  SET title_ja   = new.title_ja,
      title_en   = new.title_en,
      summary_ja = new.summary_ja,
      summary_en = new.summary_en
  WHERE page_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_trigram_delete AFTER DELETE ON pages BEGIN
  DELETE FROM pages_fts_trigram WHERE page_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS page_tags_fts_trigram_insert AFTER INSERT ON page_tags BEGIN
  UPDATE pages_fts_trigram
  SET tags_text = (
    SELECT COALESCE(GROUP_CONCAT(t.label_ja || ' ' || t.label_en, ' '), '')
    FROM page_tags pt JOIN tags t ON t.slug = pt.tag_slug
    WHERE pt.page_id = new.page_id
  )
  WHERE page_id = new.page_id;
END;

CREATE TRIGGER IF NOT EXISTS page_tags_fts_trigram_delete AFTER DELETE ON page_tags BEGIN
  UPDATE pages_fts_trigram
  SET tags_text = (
    SELECT COALESCE(GROUP_CONCAT(t.label_ja || ' ' || t.label_en, ' '), '')
    FROM page_tags pt JOIN tags t ON t.slug = pt.tag_slug
    WHERE pt.page_id = old.page_id
  )
  WHERE page_id = old.page_id;
END;
