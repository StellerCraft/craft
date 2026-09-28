-- Migration: 016_template_fulltext_search.sql
--
-- Adds full-text search to the templates table via:
--   1. A `tags` TEXT[] column for keyword tagging
--   2. A generated tsvector column that indexes name, description, and tags
--   3. A GIN index on that column for fast full-text lookups
--   4. A search helper function that returns rows ranked by relevance
--
-- Weight mapping (ts_rank):
--   A — name          (highest weight, most relevant)
--   B — tags          (secondary weight)
--   C — description   (tertiary weight)
--
-- Supports:
--   Keyword search:  to_tsquery('english', 'decentralized')
--   Prefix search:   to_tsquery('english', 'decentral:*')
--   Phrase search:   phraseto_tsquery('english', 'liquidity pool')

-- ── 1. Add tags column ────────────────────────────────────────────────────────

ALTER TABLE templates
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- ── 2. Add generated tsvector column ─────────────────────────────────────────
--
-- Combines name (weight A), tags (weight B), and description (weight C).
-- GENERATED ALWAYS AS keeps the vector in sync automatically on every write.

ALTER TABLE templates
    ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(name, '')),        'A') ||
            setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'C')
        ) STORED;

-- ── 3. GIN index for fast tsvector lookups ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_templates_search_vector
    ON templates USING GIN (search_vector);

-- ── 4. Backfill tags for existing seed templates ──────────────────────────────

UPDATE templates SET tags = ARRAY['dex', 'trading', 'stellar', 'assets', 'price-feeds']
WHERE name = 'Stellar DEX';

UPDATE templates SET tags = ARRAY['defi', 'soroban', 'lending', 'liquidity', 'yield', 'smart-contracts']
WHERE name = 'Soroban DeFi';

UPDATE templates SET tags = ARRAY['payment', 'gateway', 'invoice', 'multi-currency', 'stellar']
WHERE name = 'Payment Gateway';

UPDATE templates SET tags = ARRAY['asset', 'issuance', 'trustline', 'distribution', 'stellar']
WHERE name = 'Asset Issuance';

-- ── 5. search_templates RPC ───────────────────────────────────────────────────
--
-- Usage from Supabase JS:
--   supabase.rpc('search_templates', {
--     p_query:    'decentralized exchange',
--     p_category: null,   -- or 'dex' | 'lending' | 'payment' | 'asset-issuance'
--     p_limit:    20,
--     p_offset:   0,
--   })
--
-- Returns: rows from templates ordered by ts_rank DESC.
-- Phrase search: wrap the query in double-quotes before calling the RPC.
-- Prefix search: append :* to the last token before calling the RPC.

CREATE OR REPLACE FUNCTION search_templates(
    p_query    TEXT,
    p_category TEXT    DEFAULT NULL,
    p_limit    INTEGER DEFAULT 20,
    p_offset   INTEGER DEFAULT 0
)
RETURNS SETOF templates
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_tsquery tsquery;
BEGIN
    -- Build a tsquery from the raw input.
    -- websearch_to_tsquery handles:
    --   plain keywords  → simple AND
    --   "quoted phrases" → phraseto_tsquery
    --   prefix*         → prefix matching
    -- Falls back to plainto_tsquery if websearch syntax is unavailable.
    v_tsquery := websearch_to_tsquery('english', p_query);

    -- An empty / unparseable query returns all active templates (respecting category).
    IF v_tsquery IS NULL THEN
        RETURN QUERY
            SELECT t.*
            FROM   templates t
            WHERE  t.is_active = true
              AND  (p_category IS NULL OR t.category = p_category)
            ORDER  BY t.created_at DESC
            LIMIT  p_limit
            OFFSET p_offset;
        RETURN;
    END IF;

    RETURN QUERY
        SELECT t.*
        FROM   templates t
        WHERE  t.is_active       = true
          AND  t.search_vector  @@ v_tsquery
          AND  (p_category IS NULL OR t.category = p_category)
        ORDER  BY ts_rank(t.search_vector, v_tsquery) DESC,
                  t.created_at DESC
        LIMIT  p_limit
        OFFSET p_offset;
END;
$$;

-- Grant execute to authenticated and service roles
GRANT EXECUTE ON FUNCTION search_templates(TEXT, TEXT, INTEGER, INTEGER)
    TO authenticated, service_role;
