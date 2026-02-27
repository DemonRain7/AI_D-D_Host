/**
 * NODE 3B: Player State Loader
 *
 * Loads the current player's structured state (inventory, spell slots,
 * status effects, core stats) from Phase 3 dedicated tables.
 *
 * Fallback: returns EMPTY_PLAYER_STATE on any error.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { PlayerState, InventoryItem, SpellSlot, StatusEffect } from '../types/player-state'
import { EMPTY_PLAYER_STATE } from '../types/player-state'
import { DEFAULT_CUSTOM_ATTRIBUTES } from '../types/custom-dice'

export type PlayerStateLoaderInput = {
  sessionId: string
  supabase: SupabaseClient
}

/**
 * Loads player state from the database.
 * Reads from Phase 3 dedicated tables (player_core_stats, player_inventory, etc.)
 */
export async function loadPlayerState(
  input: PlayerStateLoaderInput
): Promise<PlayerState> {
  const { sessionId, supabase } = input

  try {
    const [
      { data: player },
      { data: coreStats },
      { data: inventoryRows },
      { data: spellSlotRows },
      { data: statusEffectRows },
      { data: customAttrRow },
    ] = await Promise.all([
      supabase.from('players').select('*').eq('session_id', sessionId).order('created_at').limit(1).maybeSingle(),
      supabase.from('player_core_stats').select('*').eq('session_id', sessionId).maybeSingle(),
      supabase.from('player_inventory').select('*').eq('session_id', sessionId),
      supabase.from('player_spell_slots').select('*').eq('session_id', sessionId),
      supabase.from('player_status_effects').select('*').eq('session_id', sessionId),
      supabase.from('player_custom_attributes').select('*').eq('session_id', sessionId).maybeSingle(),
    ])

    if (!player) {
      return { ...EMPTY_PLAYER_STATE }
    }

    // HP/MP from player_core_stats
    const hp = (coreStats?.current_hp as number) ?? 10
    const maxHp = (coreStats?.max_hp as number) ?? 10
    const mp = (coreStats?.current_mp as number) ?? 0
    const maxMp = (coreStats?.max_mp as number) ?? 0

    // ATK/DEF from player_core_stats
    const attack = (coreStats?.attack as number) ?? 2
    const defense = (coreStats?.defense as number) ?? 0

    // Inventory from player_inventory table
    const inventory: InventoryItem[] = (inventoryRows ?? []).map(row => ({
      id: row.id as string,
      itemId: (row.item_id as string | null) ?? null,
      itemName: row.item_name as string,
      quantity: row.quantity as number,
      equipped: (row.equipped as boolean) ?? false,
      slotType: (row.slot_type as string | undefined) ?? undefined,
      customProperties: (row.custom_properties as Record<string, unknown>) ?? undefined,
    }))

    // Spell slots from player_spell_slots table
    const spellSlots: SpellSlot[] = (spellSlotRows ?? []).map(row => ({
      id: row.id as string,
      level: row.slot_level as number,
      total: row.total_slots as number,
      used: row.used_slots as number,
      remaining: (row.total_slots as number) - (row.used_slots as number),
    }))

    // Status effects from player_status_effects table
    const statusEffects: StatusEffect[] = (statusEffectRows ?? []).map(row => ({
      id: row.id as string,
      effectName: row.status_name as string,
      effectType: (row.effect_type as 'buff' | 'debuff' | 'neutral') ?? 'neutral',
      sourceName: (row.source_name as string | undefined) ?? undefined,
      description: (row.description as string | undefined) ?? undefined,
      durationTurns: (row.duration as number | undefined) ?? undefined,
      appliedAt: row.applied_at as string,
    }))

    const customAttributes = customAttrRow ? {
      combat:     customAttrRow.combat     as number,
      persuasion: customAttrRow.persuasion as number,
      chaos:      customAttrRow.chaos      as number,
      charm:      customAttrRow.charm      as number,
      wit:        customAttrRow.wit        as number,
    } : { ...DEFAULT_CUSTOM_ATTRIBUTES }

    // dynamic_fields preserved for free-form custom fields (Node 7)
    const dynFields = (player.dynamic_fields as Record<string, unknown>) ?? {}

    return {
      playerId: player.id as string,
      playerName: (player.name as string) ?? '',
      hp,
      maxHp,
      mp,
      maxMp,
      attack,
      defense,
      inventory,
      spellSlots,
      statusEffects,
      customAttributes,
      customFields: dynFields as Record<string, string | number | boolean>,
    }

  } catch (error) {
    console.error('[Node 3B · PlayerState] 加载玩家状态出错:', error)
    return { ...EMPTY_PLAYER_STATE }
  }
}
