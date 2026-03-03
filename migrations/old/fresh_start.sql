-- ============================================================================
-- LLM-GM 完整数据库 Schema（fresh_start.sql）
--
-- 版本：Phase C（2025-02-25）
-- 包含：33 张表 + 9 个 RAG 函数 + 2 个触发器
--
-- 使用方法：
--   1. 在 Supabase Dashboard → Database → Extensions 中启用：
--      pgvector / ltree / pg_trgm（pgcrypto 默认已启用）
--   2. 把本文件全部内容粘贴到 SQL Editor，点 Run
--   3. 完成！
--
-- ⚠️  本脚本会先 DROP 所有相关表再重建，适用于开发环境全量重置
-- ============================================================================


-- ============================================================================
-- STEP 0: 启用必要扩展
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector：VECTOR 类型 + 向量索引
CREATE EXTENSION IF NOT EXISTS ltree;       -- ltree：地点层级路径
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- pg_trgm：模糊字符串搜索
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- pgcrypto：gen_random_uuid()


-- ============================================================================
-- STEP 1: 清除旧表（CASCADE 自动处理外键依赖）
-- ============================================================================

-- 装备/战斗系统
DROP TABLE IF EXISTS world_starter_equipment  CASCADE;
DROP TABLE IF EXISTS npc_equipment            CASCADE;
DROP TABLE IF EXISTS npc_abilities            CASCADE;
DROP TABLE IF EXISTS session_npc_stats        CASCADE;
DROP TABLE IF EXISTS session_npc_memory       CASCADE;

-- 玩家机制
DROP TABLE IF EXISTS session_milestones       CASCADE;
DROP TABLE IF EXISTS player_custom_attributes CASCADE;
DROP TABLE IF EXISTS world_dice_rules         CASCADE;
DROP TABLE IF EXISTS player_core_stats        CASCADE;
DROP TABLE IF EXISTS session_events           CASCADE;
DROP TABLE IF EXISTS player_status_effects    CASCADE;
DROP TABLE IF EXISTS player_spell_slots       CASCADE;
DROP TABLE IF EXISTS player_inventory         CASCADE;

-- 任务/故事
DROP TABLE IF EXISTS session_story_state      CASCADE;
DROP TABLE IF EXISTS session_canon_state      CASCADE;
DROP TABLE IF EXISTS session_messages         CASCADE;
DROP TABLE IF EXISTS generated_abilities      CASCADE;
DROP TABLE IF EXISTS generated_locations      CASCADE;
DROP TABLE IF EXISTS generated_characters     CASCADE;
DROP TABLE IF EXISTS generated_items          CASCADE;
DROP TABLE IF EXISTS players                  CASCADE;
DROP TABLE IF EXISTS sessions                 CASCADE;
DROP TABLE IF EXISTS world_player_fields      CASCADE;
DROP TABLE IF EXISTS story_edges              CASCADE;
DROP TABLE IF EXISTS story_nodes              CASCADE;
DROP TABLE IF EXISTS quests                   CASCADE;
DROP TABLE IF EXISTS rules                    CASCADE;
DROP TABLE IF EXISTS npcs                     CASCADE;
DROP TABLE IF EXISTS locations                CASCADE;
DROP TABLE IF EXISTS taxonomies               CASCADE;
DROP TABLE IF EXISTS organizations            CASCADE;
DROP TABLE IF EXISTS items                    CASCADE;
DROP TABLE IF EXISTS abilities                CASCADE;
DROP TABLE IF EXISTS worlds                   CASCADE;

-- 清理函数
DROP FUNCTION IF EXISTS update_location_path()           CASCADE;
DROP FUNCTION IF EXISTS update_generated_location_path() CASCADE;
DROP FUNCTION IF EXISTS match_entities_by_embedding(VECTOR, TEXT, UUID, INT, FLOAT) CASCADE;
DROP FUNCTION IF EXISTS match_items(VECTOR, UUID, INT, FLOAT)          CASCADE;
DROP FUNCTION IF EXISTS match_abilities(VECTOR, UUID, INT, FLOAT)      CASCADE;
DROP FUNCTION IF EXISTS match_locations(VECTOR, UUID, INT, FLOAT)      CASCADE;
DROP FUNCTION IF EXISTS match_npcs(VECTOR, UUID, INT, FLOAT)           CASCADE;
DROP FUNCTION IF EXISTS match_organizations(VECTOR, UUID, INT, FLOAT)  CASCADE;
DROP FUNCTION IF EXISTS match_taxonomies(VECTOR, UUID, INT, FLOAT)     CASCADE;
DROP FUNCTION IF EXISTS match_rules(VECTOR, UUID, INT, FLOAT)          CASCADE;
DROP FUNCTION IF EXISTS get_world_asset_url(TEXT)                       CASCADE;
DROP FUNCTION IF EXISTS cleanup_orphaned_world_assets()                 CASCADE;


-- ============================================================================
-- STEP 2: 世界数据表（Canon Tables）
-- ============================================================================

-- ── WORLDS ──────────────────────────────────────────────────────────────────
CREATE TABLE worlds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tone TEXT,
  setting TEXT NOT NULL,
  description TEXT NOT NULL,
  starter TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  embedding VECTOR(1536),
  image_url TEXT,
  player_defaults JSONB NOT NULL DEFAULT '{"hp":10,"mp":0,"attack":2,"defense":0}'::jsonb,
  initial_custom_attributes JSONB NOT NULL DEFAULT '{"combat":0,"persuasion":0,"chaos":0,"charm":0,"wit":0}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_worlds_aliases    ON worlds USING GIN(aliases);
CREATE INDEX idx_worlds_embedding  ON worlds USING ivfflat(embedding vector_cosine_ops);
CREATE INDEX idx_worlds_created_by ON worlds(created_by);

-- ── ABILITIES ────────────────────────────────────────────────────────────────
-- ability_stats JSONB: { mp_cost, damage, hp_restore, effect_type }
CREATE TABLE abilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  ability_stats JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_abilities_world_id  ON abilities(world_id);
CREATE INDEX idx_abilities_aliases   ON abilities USING GIN(aliases);
CREATE INDEX idx_abilities_embedding ON abilities USING ivfflat(embedding vector_cosine_ops);

COMMENT ON COLUMN abilities.ability_stats IS
  'JSONB: mp_cost, damage, hp_restore, effect_type (spell/passive/active/toggle).';

-- ── ITEMS ────────────────────────────────────────────────────────────────────
-- item_stats JSONB 规范:
--   武器:   { "type": "weapon",    "atk_bonus": 3, "def_bonus": 2, "special_effect": "..." }
--   护甲:   { "type": "armor",     "armor_slot": "head|chest|legs", "def_bonus": 2, "special_effect": "..." }
--   饰品:   { "type": "accessory", "atk_bonus": 1, "def_bonus": 1, "special_effect": "..." }
--   消耗品: { "type": "consumable", "hp_restore": 5, "mp_restore": 0 }
--   工具:   { "type": "tool" }
--   技能书: { "type": "skill_tome", "grants_ability": "火球术" }
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  is_unique BOOLEAN NOT NULL DEFAULT FALSE,
  item_stats JSONB DEFAULT '{}'::jsonb,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  unlock_node_id UUID,  -- FK added after story_nodes table is created
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_world_id  ON items(world_id);
CREATE INDEX idx_items_aliases   ON items USING GIN(aliases);
CREATE INDEX idx_items_embedding ON items USING ivfflat(embedding vector_cosine_ops);
CREATE INDEX idx_items_location  ON items(location_id) WHERE location_id IS NOT NULL;

COMMENT ON COLUMN items.item_stats IS
  'JSONB: type (weapon/armor/accessory/consumable/tool/skill_tome), atk_bonus, def_bonus, armor_slot, special_effect, hp_restore, etc.';

-- ── ORGANIZATIONS ────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_world_id  ON organizations(world_id);
CREATE INDEX idx_organizations_aliases   ON organizations USING GIN(aliases);
CREATE INDEX idx_organizations_embedding ON organizations USING ivfflat(embedding vector_cosine_ops);

-- ── TAXONOMIES ───────────────────────────────────────────────────────────────
CREATE TABLE taxonomies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_taxonomies_world_id  ON taxonomies(world_id);
CREATE INDEX idx_taxonomies_aliases   ON taxonomies USING GIN(aliases);
CREATE INDEX idx_taxonomies_embedding ON taxonomies USING ivfflat(embedding vector_cosine_ops);

-- ── LOCATIONS ────────────────────────────────────────────────────────────────
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  parent_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  path LTREE NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_locations_world_id  ON locations(world_id);
CREATE INDEX idx_locations_aliases   ON locations USING GIN(aliases);
CREATE INDEX idx_locations_embedding ON locations USING ivfflat(embedding vector_cosine_ops);
CREATE INDEX idx_locations_path      ON locations USING GIST(path);
CREATE INDEX idx_locations_parent    ON locations(parent_location_id);

CREATE OR REPLACE FUNCTION update_location_path() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_location_id IS NULL THEN
    NEW.path = text2ltree(NEW.id::TEXT);
  ELSE
    SELECT path || text2ltree(NEW.id::TEXT) INTO NEW.path
    FROM locations WHERE id = NEW.parent_location_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_location_path
BEFORE INSERT OR UPDATE ON locations
FOR EACH ROW EXECUTE FUNCTION update_location_path();

-- ── NPCS ─────────────────────────────────────────────────────────────────────
-- combat_stats JSONB: { hp, max_hp, mp, max_mp, attack, defense, is_hostile }
CREATE TABLE npcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  personality TEXT,
  motivations TEXT,
  image_url TEXT,
  combat_stats JSONB DEFAULT '{"hp":10,"max_hp":10,"mp":0,"max_mp":0,"attack":2,"defense":0,"is_hostile":false}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_npcs_world_id  ON npcs(world_id);
CREATE INDEX idx_npcs_aliases   ON npcs USING GIN(aliases);
CREATE INDEX idx_npcs_embedding ON npcs USING ivfflat(embedding vector_cosine_ops);

COMMENT ON COLUMN npcs.combat_stats IS
  'JSONB: hp, max_hp, mp, max_mp, attack (base ATK), defense (base DEF), is_hostile.';

-- ── RULES ────────────────────────────────────────────────────────────────────
CREATE TABLE rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  priority BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rules_world_id  ON rules(world_id);
CREATE INDEX idx_rules_aliases   ON rules USING GIN(aliases);
CREATE INDEX idx_rules_embedding ON rules USING ivfflat(embedding vector_cosine_ops);

-- ── QUESTS ────────────────────────────────────────────────────────────────────
CREATE TABLE quests (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id   UUID    NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  description TEXT   NOT NULL DEFAULT '',
  quest_type TEXT    NOT NULL DEFAULT 'side'
             CHECK (quest_type IN ('main', 'side', 'secret')),
  quest_order INT    NOT NULL DEFAULT 0,
  rewards    JSONB   NOT NULL DEFAULT '{}',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quests_world_id ON quests(world_id);
CREATE INDEX idx_quests_type     ON quests(world_id, quest_type);

-- ── STORY NODES ──────────────────────────────────────────────────────────────
CREATE TABLE story_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  quest_id UUID REFERENCES quests(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  trigger_conditions JSONB NOT NULL DEFAULT '{}',
  node_type TEXT NOT NULL DEFAULT 'objective'
    CHECK (node_type IN (
      'start', 'objective', 'branch', 'climax',
      'ending_good', 'ending_bad', 'ending_neutral',
      'side_start', 'side_end'
    )),
  interactive_hints TEXT[] NOT NULL DEFAULT '{}',
  completion_trigger TEXT,
  rewards JSONB NOT NULL DEFAULT '{}',
  is_start_node BOOLEAN NOT NULL DEFAULT false,
  ending_script TEXT,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_story_nodes_world_id ON story_nodes(world_id);
CREATE INDEX idx_story_nodes_aliases  ON story_nodes USING GIN(aliases);
CREATE INDEX idx_story_nodes_embedding ON story_nodes USING ivfflat(embedding vector_cosine_ops);
CREATE INDEX idx_story_nodes_quest    ON story_nodes(quest_id);
CREATE INDEX idx_story_nodes_start    ON story_nodes(world_id, is_start_node);

COMMENT ON COLUMN story_nodes.ending_script IS
  'Pre-written ending narration for ending_good/ending_bad nodes.';

-- Deferred FK: items.unlock_node_id → story_nodes (items created before story_nodes)
ALTER TABLE items ADD CONSTRAINT fk_items_unlock_node
  FOREIGN KEY (unlock_node_id) REFERENCES story_nodes(id) ON DELETE SET NULL;

-- ── STORY EDGES ──────────────────────────────────────────────────────────────
CREATE TABLE story_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES story_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES story_nodes(id) ON DELETE CASCADE,
  label TEXT,
  priority INT NOT NULL DEFAULT 0,
  condition TEXT,
  edge_type TEXT NOT NULL DEFAULT 'story'
    CHECK (edge_type IN ('story', 'fail', 'shortcut', 'secret')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_story_edges_world_id  ON story_edges(world_id);
CREATE INDEX idx_story_edges_from_node ON story_edges(from_node_id);
CREATE INDEX idx_story_edges_to_node   ON story_edges(to_node_id);

-- ── WORLD PLAYER FIELDS ──────────────────────────────────────────────────────
CREATE TABLE world_player_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('number', 'text')),
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  default_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_world_player_fields_world_id      ON world_player_fields(world_id);
CREATE INDEX idx_world_player_fields_display_order ON world_player_fields(world_id, display_order);


-- ============================================================================
-- STEP 3: 会话/运行时表
-- ============================================================================

-- ── SESSIONS ─────────────────────────────────────────────────────────────────
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  current_story_node_id UUID REFERENCES story_nodes(id) ON DELETE SET NULL,
  current_quest_id UUID REFERENCES quests(id) ON DELETE SET NULL,
  current_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  story_state TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_world_id   ON sessions(world_id);
CREATE INDEX idx_sessions_created_by ON sessions(created_by);

-- ── PLAYERS ──────────────────────────────────────────────────────────────────
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  appearance TEXT NOT NULL,
  state TEXT,
  dynamic_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_players_session_id ON players(session_id);

-- ── GENERATED ITEMS ──────────────────────────────────────────────────────────
CREATE TABLE generated_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  state TEXT,
  origin_context TEXT,
  is_unique BOOLEAN NOT NULL DEFAULT FALSE,
  source_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_generated_items_session_id ON generated_items(session_id);
CREATE INDEX idx_generated_items_world_id   ON generated_items(world_id);
CREATE INDEX idx_generated_items_aliases    ON generated_items USING GIN(aliases);
CREATE INDEX idx_generated_items_embedding  ON generated_items USING ivfflat(embedding vector_cosine_ops);

-- ── GENERATED CHARACTERS ─────────────────────────────────────────────────────
CREATE TABLE generated_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  state TEXT,
  origin_context TEXT,
  personality TEXT,
  motivations TEXT,
  image_url TEXT,
  source_npc_id UUID REFERENCES npcs(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_generated_characters_session_id ON generated_characters(session_id);
CREATE INDEX idx_generated_characters_world_id   ON generated_characters(world_id);
CREATE INDEX idx_generated_characters_aliases    ON generated_characters USING GIN(aliases);
CREATE INDEX idx_generated_characters_embedding  ON generated_characters USING ivfflat(embedding vector_cosine_ops);

-- ── GENERATED LOCATIONS ──────────────────────────────────────────────────────
CREATE TABLE generated_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  state TEXT,
  origin_context TEXT,
  parent_generated_location_id UUID REFERENCES generated_locations(id) ON DELETE SET NULL,
  parent_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  path LTREE NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_exactly_one_parent CHECK (
    (parent_generated_location_id IS NULL AND parent_location_id IS NULL) OR
    (parent_generated_location_id IS NOT NULL AND parent_location_id IS NULL) OR
    (parent_generated_location_id IS NULL AND parent_location_id IS NOT NULL)
  )
);

CREATE INDEX idx_generated_locations_session_id ON generated_locations(session_id);
CREATE INDEX idx_generated_locations_world_id   ON generated_locations(world_id);
CREATE INDEX idx_generated_locations_aliases    ON generated_locations USING GIN(aliases);
CREATE INDEX idx_generated_locations_embedding  ON generated_locations USING ivfflat(embedding vector_cosine_ops);
CREATE INDEX idx_generated_locations_path       ON generated_locations USING GIST(path);

CREATE OR REPLACE FUNCTION update_generated_location_path() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_generated_location_id IS NULL AND NEW.parent_location_id IS NULL THEN
    NEW.path = text2ltree(NEW.id::TEXT);
  ELSIF NEW.parent_generated_location_id IS NOT NULL THEN
    SELECT path || text2ltree(NEW.id::TEXT) INTO NEW.path
    FROM generated_locations WHERE id = NEW.parent_generated_location_id;
  ELSE
    SELECT path || text2ltree(NEW.id::TEXT) INTO NEW.path
    FROM locations WHERE id = NEW.parent_location_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_generated_location_path
BEFORE INSERT OR UPDATE ON generated_locations
FOR EACH ROW EXECUTE FUNCTION update_generated_location_path();

-- ── GENERATED ABILITIES ──────────────────────────────────────────────────────
CREATE TABLE generated_abilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  embedding VECTOR(1536),
  state TEXT,
  origin_context TEXT,
  source_ability_id UUID REFERENCES abilities(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_generated_abilities_session_id ON generated_abilities(session_id);
CREATE INDEX idx_generated_abilities_world_id   ON generated_abilities(world_id);
CREATE INDEX idx_generated_abilities_aliases    ON generated_abilities USING GIN(aliases);
CREATE INDEX idx_generated_abilities_embedding  ON generated_abilities USING ivfflat(embedding vector_cosine_ops);

-- ── SESSION MESSAGES ─────────────────────────────────────────────────────────
CREATE TABLE session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_messages_session_created ON session_messages(session_id, created_at);

-- ── SESSION CANON STATE ──────────────────────────────────────────────────────
CREATE TABLE session_canon_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'world', 'ability', 'item', 'organization', 'taxonomy', 'location', 'npc', 'rule', 'story_node'
  )),
  entity_id UUID NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, entity_type, entity_id)
);

CREATE INDEX idx_session_canon_state_session ON session_canon_state(session_id);
CREATE INDEX idx_session_canon_state_entity  ON session_canon_state(entity_type, entity_id);

-- ── SESSION STORY STATE ──────────────────────────────────────────────────────
CREATE TABLE session_story_state (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  node_id      UUID NOT NULL REFERENCES story_nodes(id) ON DELETE CASCADE,
  quest_id     UUID REFERENCES quests(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'completed', 'failed', 'available')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, node_id)
);

CREATE INDEX idx_sss_session ON session_story_state(session_id);
CREATE INDEX idx_sss_status  ON session_story_state(session_id, status);


-- ============================================================================
-- STEP 4: 玩家机制表
-- ============================================================================

-- ── PLAYER INVENTORY ─────────────────────────────────────────────────────────
-- 9 装备槽位: weapon_1, weapon_2, armor_head, armor_chest, armor_legs,
--             accessory_1, accessory_2, accessory_3, accessory_4
CREATE TABLE player_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id     UUID REFERENCES players(id) ON DELETE CASCADE,
  item_id       UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name     TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  equipped      BOOLEAN NOT NULL DEFAULT FALSE,
  slot_type     TEXT,    -- weapon_1|weapon_2|armor_head|armor_chest|armor_legs|accessory_1-4
  custom_properties JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_player_inventory_session ON player_inventory(session_id);
CREATE INDEX idx_player_inventory_player  ON player_inventory(player_id);

-- 每个装备槽同一时间只能装备一件物品
CREATE UNIQUE INDEX idx_player_inventory_equipped_slot
  ON player_inventory(session_id, slot_type)
  WHERE equipped = TRUE AND slot_type IS NOT NULL;

-- ── PLAYER SPELL SLOTS ───────────────────────────────────────────────────────
-- 表和类型保留，机制暂不启用（世界模组扩展预留）
CREATE TABLE player_spell_slots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id   UUID REFERENCES players(id) ON DELETE CASCADE,
  level       INTEGER NOT NULL CHECK (level BETWEEN 1 AND 9),
  total       INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  used        INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT spell_slots_used_lte_total CHECK (used <= total),
  UNIQUE (session_id, level)
);

CREATE INDEX idx_player_spell_slots_session ON player_spell_slots(session_id);

-- ── PLAYER STATUS EFFECTS ────────────────────────────────────────────────────
CREATE TABLE player_status_effects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id    UUID REFERENCES players(id) ON DELETE CASCADE,
  status_name  TEXT NOT NULL,
  description  TEXT,
  duration     INTEGER,              -- 剩余回合数（NULL = 永久）
  effect_type  TEXT NOT NULL DEFAULT 'neutral'
    CHECK (effect_type IN ('buff', 'debuff', 'neutral')),
  source_name  TEXT,                 -- 来源NPC/技能/物品名称
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  UNIQUE (player_id, status_name)
);

CREATE INDEX idx_player_status_effects_session ON player_status_effects(session_id);
CREATE INDEX idx_player_status_effects_player  ON player_status_effects(player_id);

-- ── SESSION EVENTS LOG ───────────────────────────────────────────────────────
CREATE TABLE session_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id            UUID REFERENCES players(id) ON DELETE SET NULL,
  player_message       TEXT NOT NULL,
  intent_type          TEXT NOT NULL,
  intent_confidence    FLOAT,
  mentioned_entities   TEXT[] DEFAULT '{}',
  roll_required        BOOLEAN NOT NULL DEFAULT FALSE,
  raw_roll             INTEGER,
  modifier             INTEGER,
  total                INTEGER,
  dc                   INTEGER,
  is_critical_success  BOOLEAN NOT NULL DEFAULT FALSE,
  is_critical_failure  BOOLEAN NOT NULL DEFAULT FALSE,
  outcome_type         TEXT NOT NULL,
  dice_type            TEXT,          -- COMBAT/PERSUASION/CHAOS/CHARM/WIT (NULL if no roll)
  location_id          UUID,          -- player location at time of event (for retry tracking)
  mechanical_effects   JSONB DEFAULT '[]',
  dm_response_preview  TEXT,
  latency_ms           INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_events_session    ON session_events(session_id);
CREATE INDEX idx_session_events_created_at ON session_events(created_at DESC);
CREATE INDEX idx_session_events_outcome    ON session_events(outcome_type);

-- ── PLAYER CORE STATS ────────────────────────────────────────────────────────
-- ATK/DEF 属性体系（替代 D&D 六属性）
-- 总 ATK = base attack + 装备 atk_bonus
-- 总 DEF = base defense + 装备 def_bonus
-- 战斗公式: damage = max(1, 攻击方ATK - 防御方DEF)
CREATE TABLE player_core_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id         UUID REFERENCES players(id) ON DELETE CASCADE,
  current_hp        INTEGER NOT NULL DEFAULT 10 CHECK (current_hp >= 0),
  max_hp            INTEGER NOT NULL DEFAULT 10 CHECK (max_hp > 0),
  current_mp        INTEGER NOT NULL DEFAULT 0  CHECK (current_mp >= 0),
  max_mp            INTEGER NOT NULL DEFAULT 0  CHECK (max_mp >= 0),
  attack            INTEGER NOT NULL DEFAULT 2,   -- base ATK (unarmed)
  defense           INTEGER NOT NULL DEFAULT 0,   -- base DEF (no natural armor)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id)
);

CREATE INDEX idx_player_core_stats_session ON player_core_stats(session_id);

COMMENT ON TABLE player_core_stats IS
  'ATK/DEF stat block per session. Total ATK = base + equipped bonuses. Combat: damage = max(1, ATK - DEF).';

-- ── WORLD DICE RULES ─────────────────────────────────────────────────────────
CREATE TABLE world_dice_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  intent_type     TEXT NOT NULL,
  die_type        TEXT NOT NULL DEFAULT 'd20',
  modifier_source TEXT,
  target_dc       INTEGER,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, intent_type)
);

CREATE INDEX idx_world_dice_rules_world ON world_dice_rules(world_id);

-- ── PLAYER CUSTOM ATTRIBUTES ─────────────────────────────────────────────────
-- 五维成长属性: combat(战斗), persuasion(游说), chaos(混沌), charm(魅力), wit(才智)
-- 骰子公式: d12 + attribute_value vs DC
CREATE TABLE player_custom_attributes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id  UUID REFERENCES players(id) ON DELETE CASCADE,
  combat     INTEGER NOT NULL DEFAULT 0,
  persuasion INTEGER NOT NULL DEFAULT 0,
  chaos      INTEGER NOT NULL DEFAULT 0,
  charm      INTEGER NOT NULL DEFAULT 0,
  wit        INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id)
);

CREATE INDEX idx_player_custom_attributes_session ON player_custom_attributes(session_id);
CREATE INDEX idx_player_custom_attributes_player  ON player_custom_attributes(player_id);

-- ── SESSION MILESTONES ───────────────────────────────────────────────────────
-- 五维评分 (max 100): plot_impact(30) + conflict_intensity(20) +
--   acquisition(20) + moral_weight(15) + narrative_uniqueness(15)
-- 阈值: total >= 40 → 记录
CREATE TABLE session_milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id       UUID REFERENCES players(id) ON DELETE SET NULL,
  turn_number     INTEGER,
  event_summary   TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  total_score     INTEGER NOT NULL CHECK (total_score >= 0 AND total_score <= 100),
  score_breakdown JSONB NOT NULL DEFAULT '{}',
  player_message  TEXT,
  outcome_type    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_event_type CHECK (event_type IN (
    'COMBAT_VICTORY', 'COMBAT_DEFEAT', 'MAJOR_DISCOVERY', 'ALLIANCE_FORMED',
    'BETRAYAL', 'QUEST_COMPLETE', 'ITEM_ACQUIRED', 'ABILITY_GAINED',
    'CHARACTER_DEATH', 'WORLD_CHANGE', 'MORAL_CHOICE', 'OTHER'
  ))
);

CREATE INDEX idx_session_milestones_session ON session_milestones(session_id);
CREATE INDEX idx_session_milestones_created ON session_milestones(session_id, created_at DESC);
CREATE INDEX idx_session_milestones_score   ON session_milestones(total_score DESC);


-- ============================================================================
-- STEP 5: NPC 运行时表
-- ============================================================================

-- ── SESSION NPC MEMORY ───────────────────────────────────────────────────────
CREATE TABLE session_npc_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  npc_id UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  memories TEXT[] NOT NULL DEFAULT '{}',
  attitude TEXT NOT NULL DEFAULT 'neutral',
  status TEXT NOT NULL DEFAULT 'alive',
  last_seen_turn INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, npc_id)
);

CREATE INDEX idx_session_npc_memory_session ON session_npc_memory(session_id);

-- ── SESSION NPC STATS ────────────────────────────────────────────────────────
-- 每个会话中 NPC 的实时 HP/MP（首次战斗接触时从 combat_stats 初始化）
CREATE TABLE session_npc_stats (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  npc_id       UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  current_hp   INTEGER NOT NULL DEFAULT 10,
  max_hp       INTEGER NOT NULL DEFAULT 10,
  current_mp   INTEGER NOT NULL DEFAULT 0,
  max_mp       INTEGER NOT NULL DEFAULT 0,
  is_alive     BOOLEAN NOT NULL DEFAULT true,
  in_combat    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, npc_id)
);

CREATE INDEX idx_session_npc_stats_session ON session_npc_stats(session_id);
CREATE INDEX idx_session_npc_stats_npc     ON session_npc_stats(npc_id);

-- ── NPC ABILITIES ────────────────────────────────────────────────────────────
-- NPC → 技能 关联表
CREATE TABLE npc_abilities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  npc_id       UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  ability_id   UUID NOT NULL REFERENCES abilities(id) ON DELETE CASCADE,
  droppable    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(npc_id, ability_id)
);

CREATE INDEX idx_npc_abilities_npc     ON npc_abilities(npc_id);
CREATE INDEX idx_npc_abilities_ability ON npc_abilities(ability_id);

-- ── NPC EQUIPMENT ────────────────────────────────────────────────────────────
-- 世界级 NPC 默认装备（9 槽位）
-- ATK/DEF 计算: NPC总ATK = combat_stats.attack + Σ(装备 atk_bonus)
CREATE TABLE npc_equipment (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  npc_id     UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  item_id    UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name  TEXT NOT NULL,
  slot_type  TEXT NOT NULL CHECK (slot_type IN (
    'weapon_1', 'weapon_2',
    'armor_head', 'armor_chest', 'armor_legs',
    'accessory_1', 'accessory_2', 'accessory_3', 'accessory_4'
  )),
  droppable  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(npc_id, slot_type)
);

CREATE INDEX idx_npc_equipment_npc ON npc_equipment(npc_id);

-- ── WORLD STARTER EQUIPMENT (default equipment for new players) ─────────────
CREATE TABLE world_starter_equipment (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id  UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  item_id   UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  slot_type TEXT NOT NULL CHECK (slot_type IN (
    'weapon_1','weapon_2',
    'armor_head','armor_chest','armor_legs',
    'accessory_1','accessory_2','accessory_3','accessory_4'
  )),
  UNIQUE(world_id, slot_type)
);

CREATE INDEX idx_world_starter_equipment_world ON world_starter_equipment(world_id);

ALTER TABLE world_starter_equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage world starter equipment"
  ON world_starter_equipment FOR ALL
  USING (
    world_id IN (SELECT id FROM worlds WHERE created_by = auth.uid())
  );

-- ── NPC TAXONOMIES ─────────────────────────────────────────────────────────
-- NPC → 分类 关联表 (e.g., NPC belongs to race "Dragon", species "Undead")
CREATE TABLE npc_taxonomies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  npc_id       UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  taxonomy_id  UUID NOT NULL REFERENCES taxonomies(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(npc_id, taxonomy_id)
);
CREATE INDEX idx_npc_taxonomies_npc ON npc_taxonomies(npc_id);
CREATE INDEX idx_npc_taxonomies_tax ON npc_taxonomies(taxonomy_id);

-- ── NPC ITEMS ──────────────────────────────────────────────────────────────
-- NPC → 物品 关联表 (items the NPC carries, sells, or is known for — not equipment slots)
CREATE TABLE npc_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  npc_id     UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(npc_id, item_id)
);
CREATE INDEX idx_npc_items_npc  ON npc_items(npc_id);
CREATE INDEX idx_npc_items_item ON npc_items(item_id);

-- ── NPC ORGANIZATIONS ──────────────────────────────────────────────────────
-- NPC → 组织 关联表 (which organizations/factions this NPC belongs to)
CREATE TABLE npc_organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  npc_id          UUID NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(npc_id, organization_id)
);
CREATE INDEX idx_npc_organizations_npc ON npc_organizations(npc_id);
CREATE INDEX idx_npc_organizations_org ON npc_organizations(organization_id);

-- ── WORLD STARTER ABILITIES (default abilities for new players) ────────────
CREATE TABLE world_starter_abilities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id   UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  ability_id UUID NOT NULL REFERENCES abilities(id) ON DELETE CASCADE,
  UNIQUE(world_id, ability_id)
);
CREATE INDEX idx_world_starter_abilities_world ON world_starter_abilities(world_id);

ALTER TABLE world_starter_abilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage world starter abilities"
  ON world_starter_abilities FOR ALL
  USING (
    world_id IN (SELECT id FROM worlds WHERE created_by = auth.uid())
  );

-- ── WORLD STARTER TAXONOMIES (default taxonomies for new players) ──────────
CREATE TABLE world_starter_taxonomies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id    UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  taxonomy_id UUID NOT NULL REFERENCES taxonomies(id) ON DELETE CASCADE,
  UNIQUE(world_id, taxonomy_id)
);
CREATE INDEX idx_world_starter_taxonomies_world ON world_starter_taxonomies(world_id);

ALTER TABLE world_starter_taxonomies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage world starter taxonomies"
  ON world_starter_taxonomies FOR ALL
  USING (
    world_id IN (SELECT id FROM worlds WHERE created_by = auth.uid())
  );

-- ── WORLD STARTER ITEMS (non-equipment items for new players) ──────────────
CREATE TABLE world_starter_items (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id  UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  item_id   UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity  INT NOT NULL DEFAULT 1,
  UNIQUE(world_id, item_id)
);
CREATE INDEX idx_world_starter_items_world ON world_starter_items(world_id);

ALTER TABLE world_starter_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage world starter items"
  ON world_starter_items FOR ALL
  USING (
    world_id IN (SELECT id FROM worlds WHERE created_by = auth.uid())
  );

-- ── WORLD STARTER ORGANIZATIONS (default orgs for new players) ─────────────
CREATE TABLE world_starter_organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(world_id, organization_id)
);
CREATE INDEX idx_world_starter_organizations_world ON world_starter_organizations(world_id);

ALTER TABLE world_starter_organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage world starter organizations"
  ON world_starter_organizations FOR ALL
  USING (
    world_id IN (SELECT id FROM worlds WHERE created_by = auth.uid())
  );


-- ============================================================================
-- STEP 6: RAG 向量搜索函数
-- ============================================================================

-- 通用向量搜索
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

-- Items 搜索
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

-- Abilities 搜索
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

-- Locations 搜索
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

-- NPCs 搜索（包含 combat_stats）
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

-- Organizations 搜索
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

-- Taxonomies 搜索
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

-- Rules 搜索
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

-- 权限
GRANT EXECUTE ON FUNCTION match_entities_by_embedding TO authenticated;
GRANT EXECUTE ON FUNCTION match_items          TO authenticated;
GRANT EXECUTE ON FUNCTION match_abilities      TO authenticated;
GRANT EXECUTE ON FUNCTION match_locations      TO authenticated;
GRANT EXECUTE ON FUNCTION match_npcs           TO authenticated;
GRANT EXECUTE ON FUNCTION match_organizations  TO authenticated;
GRANT EXECUTE ON FUNCTION match_taxonomies     TO authenticated;
GRANT EXECUTE ON FUNCTION match_rules          TO authenticated;


-- ============================================================================
-- STEP 7: Storage 设置
-- ============================================================================
-- 前置：在 Supabase Dashboard → Storage → Create new bucket
--   Name: world-assets, Public: YES

CREATE POLICY "Allow public uploads to world-assets"
ON storage.objects FOR INSERT TO public
WITH CHECK (bucket_id = 'world-assets');

CREATE POLICY "Allow public updates to world-assets"
ON storage.objects FOR UPDATE TO public
USING (bucket_id = 'world-assets');

CREATE POLICY "Allow public deletes from world-assets"
ON storage.objects FOR DELETE TO public
USING (bucket_id = 'world-assets');

CREATE POLICY "Allow public reads from world-assets"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'world-assets');

CREATE OR REPLACE FUNCTION get_world_asset_url(file_path TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN 'https://' || current_setting('app.settings.supabase_url', true)
    || '/storage/v1/object/public/world-assets/' || file_path;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_orphaned_world_assets()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
  file_record RECORD;
BEGIN
  FOR file_record IN
    SELECT name, bucket_id FROM storage.objects
    WHERE bucket_id = 'world-assets'
    AND name NOT IN (
      SELECT DISTINCT substring(image_url from 'world-assets/(.*)$')
      FROM worlds WHERE image_url IS NOT NULL
      UNION
      SELECT DISTINCT substring(image_url from 'world-assets/(.*)$')
      FROM npcs WHERE image_url IS NOT NULL
    )
  LOOP
    DELETE FROM storage.objects
    WHERE name = file_record.name AND bucket_id = file_record.bucket_id;
    deleted_count := deleted_count + 1;
  END LOOP;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 完成！33 张表 + 9 个 RAG 函数 + 2 个触发器 + 2 个 Storage 函数
-- ============================================================================
