/**
 * NODE 14: Events Log Writer
 *
 * Writes one row per turn to session_events for observability and replays.
 * Records: intent, dice roll, outcome, mechanical effects applied, latency.
 *
 * Gracefully skips if session_events table doesn't exist yet (Phase 2 → 3).
 * Fallback: silently skips on any DB error — never crashes the game.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { IntentClassification } from '../types/intent'
import type { DiceResolution, OutcomeSynthesis, MechanicalEffect } from '../types/game-mechanics'

export type EventsLogWriterInput = {
  sessionId: string
  playerId?: string
  playerMessage: string
  intent: IntentClassification
  dice: DiceResolution
  outcome: OutcomeSynthesis
  appliedEffects: MechanicalEffect[]
  dmResponse: string
  turnStartedAt: number   // Date.now() at start of turn
  diceType?: string           // COMBAT/PERSUASION/CHAOS/CHARM/WIT from scenarioEvent
  locationId?: string | null  // player's current_location_id (for retry tracking)
  supabase: SupabaseClient
}

export type EventsLogWriterOutput = {
  logged: boolean
  eventId?: string
}

/**
 * Writes a structured event record to session_events table.
 */
export async function writeEventLog(
  input: EventsLogWriterInput
): Promise<EventsLogWriterOutput> {
  const {
    sessionId,
    playerId,
    playerMessage,
    intent,
    dice,
    outcome,
    appliedEffects,
    dmResponse,
    turnStartedAt,
    diceType,
    locationId,
    supabase,
  } = input

  const latencyMs = Date.now() - turnStartedAt

  try {
    const eventPayload = {
      session_id: sessionId,
      player_id: playerId ?? null,
      player_message: playerMessage.substring(0, 500),  // Truncate for storage
      intent_type: intent.intent,
      intent_confidence: intent.confidence,
      mentioned_entities: intent.mentionedEntities,
      roll_required: dice.rollRequired,
      raw_roll: dice.rawRoll,
      modifier: dice.modifier,
      total: dice.total,
      dc: dice.dc,
      is_critical_success: dice.isCriticalSuccess,
      is_critical_failure: dice.isCriticalFailure,
      outcome_type: outcome.outcome,
      dice_type: diceType ?? null,
      location_id: locationId ?? null,
      mechanical_effects: appliedEffects,
      dm_response_preview: dmResponse.substring(0, 300),
      latency_ms: latencyMs,
      created_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('session_events')
      .insert(eventPayload)
      .select('id')
      .maybeSingle()

    if (error) {
      // Table may not exist yet (Phase 2) — silently ignore
      if (error.code === '42P01') {
        console.log('[Node 14 · EventsLog] session_events 表尚未迁移，跳过')
      } else {
        console.error('[Node 14 · EventsLog] 写入出错:', error.message)
      }
      return { logged: false }
    }

    console.log(`[Node 14 · EventsLog] 记录回合: intent=${intent.intent} outcome=${outcome.outcome} 延迟=${latencyMs}ms`)
    return { logged: true, eventId: data?.id }

  } catch (error) {
    console.error('[Node 14 · EventsLog] 出错，静默跳过:', error)
    return { logged: false }
  }
}
