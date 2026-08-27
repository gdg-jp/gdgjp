CREATE TABLE jobs (
  id           TEXT PRIMARY KEY NOT NULL,
  type         TEXT NOT NULL CHECK (type = 'provision_domain'),
  status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  domain_id    INTEGER NOT NULL REFERENCES domains(id),
  request_json TEXT NOT NULL,
  result_json  TEXT,
  error        TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at   TEXT,
  finished_at  TEXT
);

CREATE INDEX jobs_domain_id_idx ON jobs (domain_id);
CREATE INDEX jobs_status_idx ON jobs (status);
CREATE INDEX jobs_created_by_idx ON jobs (created_by);
