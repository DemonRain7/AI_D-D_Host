/**
 * NODE 15: Attribute Updater
 *
 * Applies ATTRIBUTE_GAIN mechanical effects to the player_custom_attributes table.
 * Runs fire-and-forget after the narrative is streamed to the player.
 *
 * Logic:
 *   - Filter mechanicalEffects for type === 'ATTRIBUTE_GAIN'
 *   - For each gain, increment the corresponding column (combat/persuasion/chaos/charm/wit)
 *   - Upsert: create the row if it doesn't exist yet (new player), increment otherwise
 *
 * Fallback: silently logs and skips on any error (game continues normally).
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { MechanicalEffect } from '../types/game-mechanics'
import type { CustomDiceType } from '../types/custom-dice'

export type AttributeUpdaterInput = {
  sessionId: string
  playerId: string | null
  effects: MechanicalEffect[]
  supabase: SupabaseClient
}

// Map CustomDiceType → column name in player_custom_attributes
const ATTR_COLUMN: Record<CustomDiceType, string> = {
  COMBAT:     'combat',
  PERSUASION: 'persuasion',
  CHAOS:      'chaos',
  CHARM:      'charm',
  WIT:        'wit',
}

/**
 * Persists attribute gains to player_custom_attributes.
 * Uses a read-then-upsert pattern to safely increment values.
 */
export async function applyAttributeGains(
  input: AttributeUpdaterInput
): Promise<void> {
  const { sessionId, playerId, effects, supabase } = input

  // Only process ATTRIBUTE_GAIN effects
  const gains = effects.filter(e => e.type === 'ATTRIBUTE_GAIN' && e.customAttribute)
  if (gains.length === 0) return

  try {
    // Fetch current attribute row (or null if not yet created)
    const { data: existing } = await supabase
      .from('player_custom_attributes')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle()

    // Build the upsert payload — start from existing values or 0
    const current = existing ?? {
      session_id:  sessionId,
      player_id:   playerId,
      combat:      0,
      persuasion:  0,
      chaos:       0,
      charm:       0,
      wit:         0,
    }

    // Accumulate all gains (handles multiple ATTRIBUTE_GAIN effects in one turn)
    const updates: Record<string, number> = {
      combat:     (current.combat     as number) ?? 0,
      persuasion: (current.persuasion as number) ?? 0,
      chaos:      (current.chaos      as number) ?? 0,
      charm:      (current.charm      as number) ?? 0,
      wit:        (current.wit        as number) ?? 0,
    }

    for (const gain of gains) {
      const col = ATTR_COLUMN[gain.customAttribute as CustomDiceType]
      if (col && col in updates) {
        updates[col] += (gain.delta ?? 1)
        console.log(`[Node 15 · Attribute] ${gain.customAttribute} +${gain.delta ?? 1} → ${updates[col]} | reason: ${gain.reason}`)
      }
    }

    const { error } = await supabase
      .from('player_custom_attributes')
      .upsert({
        session_id:  sessionId,
        player_id:   playerId ?? undefined,
        ...updates,
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'session_id' })

    if (error) {
      // Table may not exist yet (migration 029 not run) — silent skip
      if (error.code === '42P01') {
        console.warn('[Node 15 · Attribute] player_custom_attributes 表不存在，请运行迁移 029')
      } else {
        console.error('[Node 15 · Attribute] Upsert 出错:', error.message)
      }
    }

  } catch (err) {
    console.error('[Node 15 · Attribute] 意外错误（游戏继续）:', err)
  }
}
