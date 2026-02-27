/**
 * Player State Types
 *
 * Structured representation of a player's current game state,
 * loaded by the Player State Loader agent (Node 3B).
 *
 * Phase 2: reads from dynamic_fields JSONB with fallback.
 * Phase 3: reads from structured player_inventory, player_spell_slots,
 *          player_status_effects, player_core_stats, player_custom_attributes tables.
 */

import type { CustomAttributes } from './custom-dice'
import { DEFAULT_CUSTOM_ATTRIBUTES } from './custom-dice'
export type { CustomAttributes } from './custom-dice'

export type InventoryItem = {
  id: string
  itemId: string | null   // FK to world items table (null if generated/custom)
  itemName: string
  quantity: number
  equipped: boolean
  slotType?: string       // 'weapon', 'armor', 'offhand', 'ring', etc.
  customProperties?: Record<string, unknown>
}

export type SpellSlot = {
  id: string
  level: number           // 1-9
  total: number
  used: number
  remaining: number       // total - used
}

export type StatusEffect = {
  id: string
  effectName: string                                // Maps to DB: status_name
  effectType: 'buff' | 'debuff' | 'neutral'        // Maps to DB: effect_type
  sourceName?: string                               // Maps to DB: source_name (NPC/ability/item)
  description?: string                              // Maps to DB: description (flavor text)
  durationTurns?: number                            // Maps to DB: duration (turns remaining, null=indefinite)
  appliedAt: string                                 // Maps to DB: applied_at (ISO timestamp)
}

export type PlayerState = {
  playerId: string
  playerName: string
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  attack: number     // Base ATK from player_core_stats (default 2)
  defense: number    // Base DEF from player_core_stats (default 0)
  inventory: InventoryItem[]
  spellSlots: SpellSlot[]
  statusEffects: StatusEffect[]
  customFields: Record<string, string | number | boolean>
  customAttributes: CustomAttributes  // Five-dimension attribute system (战斗/游说/混沌/道德/才智)
}

export const EMPTY_PLAYER_STATE: PlayerState = {
  playerId: '',
  playerName: '',
  hp: 10,
  maxHp: 10,
  mp: 0,
  maxMp: 0,
  attack: 2,
  defense: 0,
  inventory: [],
  spellSlots: [],
  statusEffects: [],
  customFields: {},
  customAttributes: { ...DEFAULT_CUSTOM_ATTRIBUTES },
}
