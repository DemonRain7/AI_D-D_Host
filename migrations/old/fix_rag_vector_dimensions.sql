-- ============================================================================
-- RAG Vector Dimension Fix: 384 → 1536
--
-- Run this in Supabase SQL Editor AFTER re-running demo_test_world.sql
-- (or any time you see "different vector dimensions 1536 and 384" errors).
--
-- Root cause: The cloud DB has old match_* functions defined with VECTOR(384)
-- parameter type, but the embeddings are now generated as VECTOR(1536).
-- CREATE OR REPLACE can't change parameter types, so we must DROP first.
-- ============================================================================

-- ── 1. Drop all old function signatures ────────────────────────────────────

DROP FUNCTION IF EXISTS match_entities_by_embedding(vector, text, uuid, int, float);
DROP FUNCTION IF EXISTS match_items(vector, uuid, int, float);
DROP FUNCTION IF EXISTS match_abilities(vector, uuid, int, float);
DROP FUNCTION IF EXISTS match_locations(vector, uuid, int, float);
DROP FUNCTION IF EXISTS match_npcs(vector, uuid, int, float);
DROP FUNCTION IF EXISTS match_organizations(vector, uuid, int, float);
DROP FUNCTION IF EXISTS match_taxonomies(vector, uuid, int, float);
DROP FUNCTION IF EXISTS match_rules(vector, uuid, int, float);

-- ── 2. Recreate with VECTOR(1536) ─────────────────────────────────────────

-- Generic entity search
CREATE OR REPLACE FUNCTION match_entities_by_embedding(
  query_embedding VECTOR(1536),
  match_table TEXT,
  match_world_id UUID,
  match_count INT DEFAULT 5,
  match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, name TEXT, description TEXT, aliases TEXT[], similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT id, name, description,
      COALESCE(aliases, ARRAY[]::TEXT[]) as aliases,
      1 - (embedding <=> $1) AS similarity
    FROM %I
    WHERE world_id = $2
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> $1) >= $3
    ORDER BY embedding <=> $1
    LIMIT $4',
    match_table
  )
  USING query_embedding, match_world_id, match_threshold, match_count;
END;
$$;

-- Items search
CREATE OR REPLACE FUNCTION match_items(
  query_embedding VECTOR(1536), world_id UUID,
  match_count INT DEFAULT 5, match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, name TEXT, description TEXT, aliases TEXT[], is_unique BOOLEAN, item_stats JSONB, location_id UUID, unlock_node_id UUID, similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT items.id, items.name, items.description,
    COALESCE(items.aliases, ARRAY[]::TEXT[]),
    items.is_unique,
    items.item_stats,
    items.location_id,
    items.unlock_node_id,
    1 - (items.embedding <=> query_embedding) AS similarity
  FROM items
  WHERE items.world_id = match_items.world_id
    AND items.embedding IS NOT NULL
    AND 1 - (items.embedding <=> query_embedding) >= match_threshold
  ORDER BY items.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Abilities search
CREATE OR REPLACE FUNCTION match_abilities(
  query_embedding VECTOR(1536), world_id UUID,
  match_count INT DEFAULT 5, match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, name TEXT, description TEXT, aliases TEXT[], similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT abilities.id, abilities.name, abilities.description,
    COALESCE(abilities.aliases, ARRAY[]::TEXT[]),
    1 - (abilities.embedding <=> query_embedding) AS similarity
  FROM abilities
  WHERE abilities.world_id = match_abilities.world_id
    AND abilities.embedding IS NOT NULL
    AND 1 - (abilities.embedding <=> query_embedding) >= match_threshold
  ORDER BY abilities.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Locations search
CREATE OR REPLACE FUNCTION match_locations(
  query_embedding VECTOR(1536), world_id UUID,
  match_count INT DEFAULT 5, match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, name TEXT, description TEXT, aliases TEXT[], similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT locations.id, locations.name, locations.description,
    COALESCE(locations.aliases, ARRAY[]::TEXT[]),
    1 - (locations.embedding <=> query_embedding) AS similarity
  FROM locations
  WHERE locations.world_id = match_locations.world_id
    AND locations.embedding IS NOT NULL
    AND 1 - (locations.embedding <=> query_embedding) >= match_threshold
  ORDER BY locations.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- NPCs search (with combat_stats)
CREATE OR REPLACE FUNCTION match_npcs(
  query_embedding VECTOR(1536), world_id UUID,
  match_count INT DEFAULT 5, match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, aliases TEXT[],
  personality TEXT, motivations TEXT, combat_stats JSONB, similarity FLOAT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT npcs.id, npcs.name, npcs.description,
    COALESCE(npcs.aliases, ARRAY[]::TEXT[]),
    npcs.personality, npcs.motivations, npcs.combat_stats,
    1 - (npcs.embedding <=> query_embedding) AS similarity
  FROM npcs
  WHERE npcs.world_id = match_npcs.world_id
    AND npcs.embedding IS NOT NULL
    AND 1 - (npcs.embedding <=> query_embedding) >= match_threshold
  ORDER BY npcs.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Organizations search
CREATE OR REPLACE FUNCTION match_organizations(
  query_embedding VECTOR(1536), world_id UUID,
  match_count INT DEFAULT 5, match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, name TEXT, description TEXT, aliases TEXT[], similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT organizations.id, organizations.name, organizations.description,
    COALESCE(organizations.aliases, ARRAY[]::TEXT[]),
    1 - (organizations.embedding <=> query_embedding) AS similarity
  FROM organizations
  WHERE organizations.world_id = match_organizations.world_id
    AND organizations.embedding IS NOT NULL
    AND 1 - (organizations.embedding <=> query_embedding) >= match_threshold
  ORDER BY organizations.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Taxonomies search
CREATE OR REPLACE FUNCTION match_taxonomies(
  query_embedding VECTOR(1536), world_id UUID,
  match_count INT DEFAULT 5, match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, name TEXT, description TEXT, aliases TEXT[], similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT taxonomies.id, taxonomies.name, taxonomies.description,
    COALESCE(taxonomies.aliases, ARRAY[]::TEXT[]),
    1 - (taxonomies.embedding <=> query_embedding) AS similarity
  FROM taxonomies
  WHERE taxonomies.world_id = match_taxonomies.world_id
    AND taxonomies.embedding IS NOT NULL
    AND 1 - (taxonomies.embedding <=> query_embedding) >= match_threshold
  ORDER BY taxonomies.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Rules search
CREATE OR REPLACE FUNCTION match_rules(
  query_embedding VECTOR(1536), world_id UUID,
  match_count INT DEFAULT 10, match_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (id UUID, name TEXT, description TEXT, aliases TEXT[], priority BOOLEAN, similarity FLOAT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT rules.id, rules.name, rules.description,
    COALESCE(rules.aliases, ARRAY[]::TEXT[]),
    rules.priority,
    1 - (rules.embedding <=> query_embedding) AS similarity
  FROM rules
  WHERE rules.world_id = match_rules.world_id
    AND rules.embedding IS NOT NULL
    AND 1 - (rules.embedding <=> query_embedding) >= match_threshold
  ORDER BY rules.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ── 3. Grant permissions ───────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION match_entities_by_embedding TO authenticated;
GRANT EXECUTE ON FUNCTION match_entities_by_embedding TO anon;
GRANT EXECUTE ON FUNCTION match_items TO authenticated;
GRANT EXECUTE ON FUNCTION match_items TO anon;
GRANT EXECUTE ON FUNCTION match_abilities TO authenticated;
GRANT EXECUTE ON FUNCTION match_abilities TO anon;
GRANT EXECUTE ON FUNCTION match_locations TO authenticated;
GRANT EXECUTE ON FUNCTION match_locations TO anon;
GRANT EXECUTE ON FUNCTION match_npcs TO authenticated;
GRANT EXECUTE ON FUNCTION match_npcs TO anon;
GRANT EXECUTE ON FUNCTION match_organizations TO authenticated;
GRANT EXECUTE ON FUNCTION match_organizations TO anon;
GRANT EXECUTE ON FUNCTION match_taxonomies TO authenticated;
GRANT EXECUTE ON FUNCTION match_taxonomies TO anon;
GRANT EXECUTE ON FUNCTION match_rules TO authenticated;
GRANT EXECUTE ON FUNCTION match_rules TO anon;

-- ============================================================================
-- Done! All 8 match_* RPCs now accept VECTOR(1536) embeddings.
-- ============================================================================
