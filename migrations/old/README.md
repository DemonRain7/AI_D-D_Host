# Database Migrations

SQL schema and seed data for the LLM-GM TTRPG system.

## Files

| File | Purpose |
|------|---------|
| `fresh_start.sql` | **Complete schema** — 33 tables + 9 RAG functions + 2 triggers. Drop-and-recreate, for dev reset. |
| `demo_test_world.sql` | **Demo world seed** — 幻象试炼场 (Phantom Trial Arena) with NPCs, items, abilities, quests, equipment. |
| `seed_world_aethoria.sql` | **Aethoria world seed** — 艾瑟利亚 full fantasy world (separate from demo). |

## Quick Start

1. Enable extensions in Supabase Dashboard: `pgvector`, `ltree`, `pg_trgm`
2. Run `fresh_start.sql` in SQL Editor
3. Run `demo_test_world.sql` to load the demo world

## Schema Overview

### Canon Tables (world-scoped)
- `worlds`, `abilities`, `items`, `organizations`, `taxonomies`, `locations`, `npcs`, `rules`
- `quests`, `story_nodes`, `story_edges`, `world_player_fields`
- `npc_abilities` (NPC-ability junction), `npc_equipment` (NPC gear, 9 slots)

### Session Tables (runtime)
- `sessions`, `players`, `session_messages`, `session_canon_state`
- `generated_items`, `generated_characters`, `generated_locations`, `generated_abilities`
- `session_story_state`, `session_npc_memory`, `session_npc_stats`

### Player Mechanics
- `player_core_stats` — HP/MP/ATK/DEF (ATK-DEF combat formula)
- `player_inventory` — 9 equipment slots (weapon_1/2, armor_head/chest/legs, accessory_1-4)
- `player_spell_slots` — reserved for world module extension
- `player_status_effects` — buff/debuff/neutral with source tracking
- `player_custom_attributes` — five-dimension growth (combat/persuasion/chaos/charm/wit)
- `session_events`, `session_milestones`
- `world_dice_rules`

### Combat System
- **ATK/DEF formula**: `damage = max(1, attacker_ATK - defender_DEF)`
- **Player ATK** = `player_core_stats.attack` + equipped weapon/accessory `atk_bonus`
- **Player DEF** = `player_core_stats.defense` + equipped armor/accessory `def_bonus`
- **NPC ATK** = `npcs.combat_stats.attack` + `npc_equipment` weapon `atk_bonus`
- **NPC DEF** = `npcs.combat_stats.defense` + `npc_equipment` armor `def_bonus`

### Item Stats JSONB Format
```json
Weapon:    { "type": "weapon",     "atk_bonus": 3 }
Armor:     { "type": "armor",      "armor_slot": "head|chest|legs", "def_bonus": 2 }
Accessory: { "type": "accessory",  "atk_bonus": 1, "def_bonus": 1 }
Consumable:{ "type": "consumable", "hp_restore": 5, "mp_restore": 0 }
Tool:      { "type": "tool" }
Skill Tome:{ "type": "skill_tome", "grants_ability": "Fire Ball" }
```

### RAG Vector Search
9 functions for semantic search using pgvector cosine similarity:
`match_items`, `match_abilities`, `match_locations`, `match_npcs` (with `combat_stats`),
`match_organizations`, `match_taxonomies`, `match_rules`, `match_entities_by_embedding`
