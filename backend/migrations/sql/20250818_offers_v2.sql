-- backend/migrations/sql/20250818_offers_v2.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE IF EXISTS offers
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_offers_rest_status_exp ON offers (restaurant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_offers_title_trgm ON offers USING GIN (title gin_trgm_ops);

UPDATE offers SET status='expired'
WHERE expires_at IS NOT NULL AND expires_at < NOW() AND status NOT IN ('archived','expired');
