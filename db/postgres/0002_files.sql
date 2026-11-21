-- Metadatos de los archivos guardados en Supabase Storage (bucket privado erp-files).
CREATE TABLE IF NOT EXISTS erp_files (
  key text PRIMARY KEY,
  content_type text NOT NULL,
  cache_control text,
  size integer NOT NULL,
  etag text NOT NULL,
  custom text NOT NULL DEFAULT '{}',
  created_at text NOT NULL
);
ALTER TABLE erp_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_files FROM anon, authenticated;
