-- Esquema de AIMERKA en Postgres (Supabase). Equivale a drizzle/0000 de D1.
-- Solo el servidor accede (conexión directa); RLS sin políticas bloquea la API pública.
CREATE TABLE IF NOT EXISTS erp_workspaces (
  id text PRIMARY KEY,
  revision integer NOT NULL DEFAULT 0,
  initialized integer NOT NULL DEFAULT 0,
  last_action text NOT NULL DEFAULT '',
  updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS erp_fragments (
  workspace text NOT NULL,
  name text NOT NULL,
  part integer NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (workspace, name, part)
);
CREATE TABLE IF NOT EXISTS erp_actions (
  workspace text NOT NULL,
  id text NOT NULL,
  type text NOT NULL,
  input_hash text NOT NULL,
  result text NOT NULL,
  revision integer NOT NULL,
  actor text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (workspace, id)
);
CREATE INDEX IF NOT EXISTS erp_actions_revision ON erp_actions (workspace, revision DESC);
ALTER TABLE erp_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_fragments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_actions    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_workspaces, erp_fragments, erp_actions FROM anon, authenticated;
