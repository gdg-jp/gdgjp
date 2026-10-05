-- Region taxonomy for chapter onboarding browse (north → south order in app).
ALTER TABLE chapters ADD COLUMN region TEXT NOT NULL DEFAULT 'other'
  CHECK (region IN (
    'hokkaido',
    'tohoku',
    'kanto',
    'chubu',
    'kansai',
    'chugoku',
    'shikoku',
    'kyushu',
    'other'
  ));

-- Seed from production directory (slug-stable across environments).
UPDATE chapters SET region = 'hokkaido' WHERE slug IN ('gdg-sapporo');

UPDATE chapters SET region = 'tohoku' WHERE slug IN (
  'gdg-tohoku',
  'gdg-fukushima',
  'gdg-cloud-fukushima',
  'gdg-ishinomaki',
  'gdgoc-aizu'
);

UPDATE chapters SET region = 'kanto' WHERE slug IN (
  'gdg-tokyo',
  'gdgoc-chiba',
  'gdgoc-chuo',
  'gdgoc-hitotsubashi',
  'gdgoc-sophia',
  'gdgoc-tcu',
  'gdgoc-tmu',
  'gdgoc-tuat',
  'gdgoc-tsuda',
  'gdgoc-tokyo',
  'gdgoc-waseda',
  'gdgoc-iput'
);

UPDATE chapters SET region = 'chubu' WHERE slug IN ('gdg-nagoya');

UPDATE chapters SET region = 'kansai' WHERE slug IN (
  'gdg-kwansai',
  'gdg-osaka',
  'gdg-kyoto',
  'gdg-kobe',
  'gdg-nara',
  'gdg-wakayama',
  'gdgoc-osaka',
  'gdgoc-omu',
  'gdgoc-kobe',
  'gdgoc-kyoto',
  'gdgoc-doshisha',
  'gdgoc-kit',
  'gdgoc-kwu'
);

UPDATE chapters SET region = 'chugoku' WHERE slug IN ('gdgoc-okayama');

UPDATE chapters SET region = 'shikoku' WHERE slug IN ('gdg-shikoku');

UPDATE chapters SET region = 'kyushu' WHERE slug IN (
  'gdg-kyushu',
  'gdg-cloud-oita'
);

UPDATE chapters SET region = 'other' WHERE slug IN ('demo', 'gde');
