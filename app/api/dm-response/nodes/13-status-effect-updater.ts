/**
 * NODE 13: Status Effect Updater
 *
 * Applies STATUS_ADD and STATUS_REMOVE mechanical effects.
 * Uses player_status_effects table (Phase 3).
 * No Phase 2 fallback needed — status effects are a new feature.
 *
 * Fallback: silently skips on any DB error — never crashes the game.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { MechanicalEffect } from '../types/game-mechanics'

export type StatusEffectUpdaterInput = {
  sessionId: string
  effects: MechanicalEffect[]
  supabase: SupabaseClient
}

export type StatusEffectUpdaterOutput = {
  applied: boolean
  added: string[]
  removed: string[]
}

/**
 * Applies status effect changes to the player.
 */
export async function applyStatusEffects(
  input: StatusEffectUpdaterInput
): Promise<StatusEffectUpdaterOutput> {
  const { sessionId, effects, supabase } = input

  const addEffects = effects.filter(e => e.type === 'STATUS_ADD' && e.statusName)
  const removeEffects = effects.filter(e => e.type === 'STATUS_REMOVE' && e.statusName)

  if (addEffects.length === 0 && removeEffects.length === 0) {
    return { applied: false, added: [], removed: [] }
  }

  const added: string[] = []
  const removed: string[] = []

  try {
    // Get player id for this session
    const { data: player } = await supabase
      .from('players')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (!player) return { applied: false, added: [], removed: [] }

    const playerId = player.id

    // Add status effects (with optional duration, type, source, description)
    for (const effect of addEffects) {
      const upsertData: Record<string, unknown> = {
        player_id: playerId,
        session_id: sessionId,
        status_name: effect.statusName,
        applied_at: new Date().toISOString(),
      }
      if (effect.statusEffectType) upsertData.effect_type = effect.statusEffectType
      if (effect.statusDescription) upsertData.description = effect.statusDescription
      if (effect.statusDuration != null) upsertData.duration = effect.statusDuration
      if (effect.statusSourceName) upsertData.source_name = effect.statusSourceName

      const { error } = await supabase
        .from('player_status_effects')
        .upsert(upsertData, { onConflict: 'player_id,status_name' })
      if (!error) added.push(effect.statusName!)
    }

    // Remove status effects
    if (removeEffects.length > 0) {
      const statusNamesToRemove = removeEffects.map(e => e.statusName!)
      const { error } = await supabase
        .from('player_status_effects')
        .delete()
        .eq('player_id', playerId)
        .in('status_name', statusNamesToRemove)
      if (!error) removed.push(...statusNamesToRemove)
    }

    console.log(`[Node 13 · StatusEffect] 添加=[${added.join(', ')}] 移除=[${removed.join(', ')}]`)
    return { applied: added.length > 0 || removed.length > 0, added, removed }

  } catch (error) {
    console.error('[Node 13 · StatusEffect] 出错，静默跳过:', error)
    return { applied: false, added: [], removed: [] }
  }
}
