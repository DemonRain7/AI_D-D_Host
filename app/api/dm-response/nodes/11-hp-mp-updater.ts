/**
 * NODE 11: HP/MP Updater
 *
 * Applies HP_DELTA and MP_DELTA effects to the player,
 * NPC_HP_DELTA effects to NPC HP, and NPC_MP_DELTA effects to NPC MP.
 * Reads from player_core_stats (Phase 3). Skips if no core stats record.
 *
 * Fallback: silently skips on any DB error — never crashes the game.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { MechanicalEffect } from '../types/game-mechanics'
import type { NpcCombatStats } from './2-data-retrieval'

export type HPMPUpdaterInput = {
  sessionId: string
  effects: MechanicalEffect[]
  supabase: SupabaseClient
  combatNpcId?: string | null  // NPC currently in combat — sets in_combat=true on insert, false on death
}

export type HPMPUpdaterOutput = {
  applied: boolean
  hpDelta: number
  mpDelta: number
  npcUpdates: number  // Count of NPC HP records updated
}

/**
 * Applies HP and MP changes using player_core_stats.
 */
export async function applyHPMPChanges(
  input: HPMPUpdaterInput
): Promise<HPMPUpdaterOutput> {
  const { sessionId, effects, supabase, combatNpcId } = input

  const hpEffects = effects.filter(e => e.type === 'HP_DELTA')
  const mpEffects = effects.filter(e => e.type === 'MP_DELTA')
  const npcHpEffects = effects.filter(e => e.type === 'NPC_HP_DELTA')
  const npcMpEffects = effects.filter(e => e.type === 'NPC_MP_DELTA')

  if (hpEffects.length === 0 && mpEffects.length === 0 && npcHpEffects.length === 0 && npcMpEffects.length === 0) {
    return { applied: false, hpDelta: 0, mpDelta: 0, npcUpdates: 0 }
  }

  const totalHpDelta = hpEffects.reduce((sum, e) => sum + (e.delta ?? 0), 0)
  const totalMpDelta = mpEffects.reduce((sum, e) => sum + (e.delta ?? 0), 0)

  try {
    // Try Phase 3: player_core_stats table
    const { data: coreStats } = await supabase
      .from('player_core_stats')
      .select('player_id, current_hp, max_hp, current_mp, max_mp')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (!coreStats) {
      console.warn('[Node 11 · HPMP] 无player_core_stats，跳过HP/MP更新')
      const npcHpUpdated = await applyNPCHPChanges(sessionId, npcHpEffects, supabase, combatNpcId)
      const npcMpUpdated = await applyNPCMPChanges(sessionId, npcMpEffects, supabase, combatNpcId)
      return { applied: false, hpDelta: 0, mpDelta: 0, npcUpdates: npcHpUpdated + npcMpUpdated }
    }

    const newHp = Math.max(0, Math.min(coreStats.max_hp, coreStats.current_hp + totalHpDelta))
    const newMp = Math.max(0, Math.min(coreStats.max_mp, coreStats.current_mp + totalMpDelta))

    await supabase
      .from('player_core_stats')
      .update({ current_hp: newHp, current_mp: newMp, updated_at: new Date().toISOString() })
      .eq('session_id', sessionId)

    console.log(`[Node 11 · HPMP] HP: ${coreStats.current_hp} → ${newHp} (${totalHpDelta >= 0 ? '+' : ''}${totalHpDelta}), MP: ${coreStats.current_mp} → ${newMp}`)
    const npcHpUpdated = await applyNPCHPChanges(sessionId, npcHpEffects, supabase, combatNpcId)
    const npcMpUpdated = await applyNPCMPChanges(sessionId, npcMpEffects, supabase, combatNpcId)
    return { applied: true, hpDelta: totalHpDelta, mpDelta: totalMpDelta, npcUpdates: npcHpUpdated + npcMpUpdated }

  } catch (error) {
    console.error('[Node 11 · HPMP] 出错，静默跳过:', error)
    return { applied: false, hpDelta: 0, mpDelta: 0, npcUpdates: 0 }
  }
}

/**
 * Updates session_npc_stats for each NPC_HP_DELTA effect.
 * On first contact, initializes the record from the NPC's combat_stats.max_hp.
 * Returns the number of NPC records successfully updated.
 */
async function applyNPCHPChanges(
  sessionId: string,
  npcHpEffects: MechanicalEffect[],
  supabase: SupabaseClient,
  combatNpcId?: string | null,
): Promise<number> {
  if (npcHpEffects.length === 0) return 0

  let updated = 0
  for (const eff of npcHpEffects) {
    if (!eff.npcId) continue
    const delta = eff.delta ?? 0
    const isTheCombatNpc = !!combatNpcId && eff.npcId === combatNpcId

    try {
      const { data: existing } = await supabase
        .from('session_npc_stats')
        .select('current_hp, max_hp, current_mp')
        .eq('session_id', sessionId)
        .eq('npc_id', eff.npcId)
        .maybeSingle()

      if (existing) {
        const newHp = Math.max(0, existing.current_hp + delta)
        const updateData: Record<string, unknown> = {
          current_hp: newHp,
          is_alive: newHp > 0,
          updated_at: new Date().toISOString(),
        }
        // NPC died → clear in_combat flag
        if (newHp <= 0) updateData.in_combat = false
        // Ensure combat NPC has in_combat=true (idempotent)
        if (isTheCombatNpc && newHp > 0) updateData.in_combat = true
        await supabase
          .from('session_npc_stats')
          .update(updateData)
          .eq('session_id', sessionId)
          .eq('npc_id', eff.npcId)
        console.log(`[Node 11 · NPC HP] NPC ${eff.npcId}: HP ${existing.current_hp} → ${newHp} (${delta})${newHp <= 0 ? ' ☠️ in_combat=false' : ''}`)
      } else {
        // First combat contact — initialize from NPC's combat_stats.max_hp
        const { data: npc } = await supabase
          .from('npcs')
          .select('combat_stats')
          .eq('id', eff.npcId)
          .maybeSingle()
        const maxHp = (npc?.combat_stats as NpcCombatStats | null)?.max_hp ?? 10
        const maxMp = (npc?.combat_stats as NpcCombatStats | null)?.max_mp ?? 0
        const newHp = Math.max(0, maxHp + delta)
        await supabase.from('session_npc_stats').insert({
          session_id: sessionId,
          npc_id: eff.npcId,
          current_hp: newHp,
          max_hp: maxHp,
          current_mp: maxMp,
          max_mp: maxMp,
          is_alive: newHp > 0,
          in_combat: isTheCombatNpc && newHp > 0,  // Set in_combat=true for the combat target
        })
        console.log(`[Node 11 · NPC HP] NPC ${eff.npcId} 首次接触，HP=${maxHp} → ${newHp} (${delta}), MP=${maxMp}, in_combat=${isTheCombatNpc}`)
      }
      updated++
    } catch (err) {
      console.warn(`[Node 11 · NPC HP] NPC ${eff.npcId} 更新失败，静默跳过:`, err)
    }
  }
  return updated
}

/**
 * Updates session_npc_stats MP for each NPC_MP_DELTA effect.
 * If no session_npc_stats record exists yet (NPC not initialized), initializes it first.
 * Returns the number of NPC MP records successfully updated.
 */
async function applyNPCMPChanges(
  sessionId: string,
  npcMpEffects: MechanicalEffect[],
  supabase: SupabaseClient,
  combatNpcId?: string | null,
): Promise<number> {
  if (npcMpEffects.length === 0) return 0

  let updated = 0
  for (const eff of npcMpEffects) {
    if (!eff.npcId) continue
    const delta = eff.delta ?? 0
    const isTheCombatNpc = !!combatNpcId && eff.npcId === combatNpcId

    try {
      const { data: existing } = await supabase
        .from('session_npc_stats')
        .select('current_mp, max_mp')
        .eq('session_id', sessionId)
        .eq('npc_id', eff.npcId)
        .maybeSingle()

      if (existing) {
        const newMp = Math.max(0, (existing.current_mp ?? 0) + delta)
        await supabase
          .from('session_npc_stats')
          .update({ current_mp: newMp, updated_at: new Date().toISOString() })
          .eq('session_id', sessionId)
          .eq('npc_id', eff.npcId)
        console.log(`[Node 11 · NPC MP] NPC ${eff.npcId}: MP ${existing.current_mp ?? 0} → ${newMp} (${delta})`)
      } else {
        // NPC not yet initialized — init from combat_stats then apply delta
        const { data: npc } = await supabase
          .from('npcs')
          .select('combat_stats')
          .eq('id', eff.npcId)
          .maybeSingle()
        const maxHp = (npc?.combat_stats as NpcCombatStats | null)?.max_hp ?? 10
        const maxMp = (npc?.combat_stats as NpcCombatStats | null)?.max_mp ?? 0
        const newMp = Math.max(0, maxMp + delta)
        await supabase.from('session_npc_stats').insert({
          session_id: sessionId,
          npc_id: eff.npcId,
          current_hp: maxHp,
          max_hp: maxHp,
          current_mp: newMp,
          max_mp: maxMp,
          is_alive: true,
          in_combat: isTheCombatNpc,  // Set in_combat=true for the combat target
        })
        console.log(`[Node 11 · NPC MP] NPC ${eff.npcId} 首次接触(MP)，MP=${maxMp} → ${newMp} (${delta}), in_combat=${isTheCombatNpc}`)
      }
      updated++
    } catch (err) {
      console.warn(`[Node 11 · NPC MP] NPC ${eff.npcId} MP更新失败，静默跳过:`, err)
    }
  }
  return updated
}
