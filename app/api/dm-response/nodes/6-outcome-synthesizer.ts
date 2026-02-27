/**
 * NODE 6: Outcome Synthesizer
 *
 * Pure function — no LLM, no database calls.
 * Combines precondition + dice results → final OutcomeType + mechanical effects.
 *
 * Fallback: returns SUCCESS with empty effects on any error.
 *
 * Success thresholds (d12 scale, attribute modifier starts at 0):
 *   Natural 1              → CRITICAL_FAILURE
 *   Natural 12             → CRITICAL_SUCCESS
 *   total ≥ DC + 4         → CRITICAL_SUCCESS
 *   DC ≤ total < DC + 4    → SUCCESS    → +1 to custom attribute
 *   DC - 2 ≤ total < DC    → PARTIAL    → no attribute gain
 *   total < DC - 2         → FAILURE    → no attribute gain
 *   Precondition blocked   → PRECONDITION_FAILED
 *
 * Attribute growth: on SUCCESS or CRITICAL_SUCCESS, the corresponding
 * custom attribute (战斗/游说/混沌/道德/才智) gains +1 via ATTRIBUTE_GAIN effect.
 */

import type { PreconditionResult, DiceResolution, OutcomeSynthesis, OutcomeType, MechanicalEffect } from '../types/game-mechanics'
import { FALLBACK_OUTCOME } from '../types/game-mechanics'
import type { IntentClassification } from '../types/intent'
import type { PlayerState } from '../types/player-state'
import type { ScenarioEvent } from '../types/custom-dice'
import { CUSTOM_DICE_LABELS } from '../types/custom-dice'

export type NpcAbilityForCombat = {
  name: string
  damage: number
  mp_cost: number
  hp_restore: number
}

export type OutcomeSynthesizerInput = {
  intent: IntentClassification
  precondition: PreconditionResult
  dice: DiceResolution
  playerState: PlayerState
  scenarioEvent: ScenarioEvent   // From Node 3C — carries diceType for attribute gain
  npcCombatStats?: { npcId: string; attack: number; defense: number; currentMp?: number } | null
  npcAbilities?: NpcAbilityForCombat[]  // NPC's linked abilities with stats
  chosenNpcAbility?: NpcAbilityForCombat | null  // Pre-selected by Node 6C agent
  playerTotalATK?: number        // Player total ATK (base + equipment bonuses, default 2)
  playerTotalDEF?: number        // Player total DEF (base + equipment bonuses, default 0)
  playerAbilityDamage?: number   // Active ability's damage value from ability_stats.damage (SPELL_CAST only)
  playerAbilityMpCost?: number   // Active ability's MP cost from ability_stats.mp_cost (SPELL_CAST only)
  inCombat?: boolean             // Whether the player is currently in combat (from DB in_combat flag)
  usedItemStats?: { hpRestore?: number; mpRestore?: number }  // For ITEM_USE: restoration values from item_stats
}

/**
 * Determines the outcome type from dice results and DC.
 * Thresholds are scaled for d12 (max 12) vs original d20 (max 20).
 */
function determineOutcomeType(dice: DiceResolution): OutcomeType {
  if (!dice.rollRequired) return 'SUCCESS'

  if (dice.isCriticalFailure) return 'CRITICAL_FAILURE'
  if (dice.isCriticalSuccess) return 'CRITICAL_SUCCESS'

  const { total, dc, rolls } = dice
  if (dc === null) return 'SUCCESS'

  // Scale thresholds based on die type
  const dieType = rolls[0]?.dieType ?? 'd20'
  const critBonus  = dieType === 'd12' ? 4 : 10  // How far above DC = critical
  const partialMiss = dieType === 'd12' ? 2 : 5  // How far below DC = partial

  if (total >= dc + critBonus) return 'CRITICAL_SUCCESS'
  if (total >= dc)             return 'SUCCESS'
  if (total >= dc - partialMiss) return 'PARTIAL'
  return 'FAILURE'
}

/**
 * Derives mechanical effects from the outcome.
 * Includes ATTRIBUTE_GAIN on success when a custom dice event was triggered.
 */
function deriveMechanicalEffects(
  intent: IntentClassification,
  outcome: OutcomeType,
  precondition: PreconditionResult,
  scenarioEvent: ScenarioEvent,
  npcCombatStats?: { npcId: string; attack: number; defense: number; currentMp?: number } | null,
  npcAbilities?: NpcAbilityForCombat[],
  chosenNpcAbility?: NpcAbilityForCombat | null,
  playerTotalATK?: number,
  playerTotalDEF?: number,
  playerAbilityDamage?: number,
  playerAbilityMpCost?: number,
  inCombat?: boolean,
  usedItemStats?: { hpRestore?: number; mpRestore?: number },
): MechanicalEffect[] {
  const effects: MechanicalEffect[] = []

  // Spell MP cost deduction on cast attempt (even on failure)
  if (intent.intent === 'SPELL_CAST' && outcome !== 'PRECONDITION_FAILED' && playerAbilityMpCost && playerAbilityMpCost > 0) {
    effects.push({
      type: 'MP_DELTA',
      delta: -playerAbilityMpCost,
      reason: `施法消耗${playerAbilityMpCost}MP`,
    })
  }

  // Item consumption is handled by Node 19 (Narrative State Sync) which
  // analyzes the DM's actual narrative to distinguish between:
  //   - "used/consumed" (potion drunk → remove from inventory)
  //   - "equipped/unequipped" (sword drawn/sheathed → toggle flag)
  //   - "gained" (item picked up → add to inventory)
  // Previously this blindly generated ITEM_CONSUMED for all ITEM_USE + SUCCESS,
  // which incorrectly deleted weapons/armor on equip/unequip actions.

  // Item usage HP/MP restoration: on SUCCESS or CRITICAL_SUCCESS, apply item's hp_restore/mp_restore
  if (intent.intent === 'ITEM_USE' && usedItemStats && (outcome === 'SUCCESS' || outcome === 'CRITICAL_SUCCESS')) {
    const critMultiplier = outcome === 'CRITICAL_SUCCESS' ? 1.5 : 1
    if (usedItemStats.hpRestore && usedItemStats.hpRestore > 0) {
      const hpAmount = Math.ceil(usedItemStats.hpRestore * critMultiplier)
      effects.push({
        type: 'HP_DELTA',
        delta: hpAmount,
        reason: `使用物品恢复${hpAmount}HP${outcome === 'CRITICAL_SUCCESS' ? '（大成功×1.5）' : ''}`,
      })
    }
    if (usedItemStats.mpRestore && usedItemStats.mpRestore > 0) {
      const mpAmount = Math.ceil(usedItemStats.mpRestore * critMultiplier)
      effects.push({
        type: 'MP_DELTA',
        delta: mpAmount,
        reason: `使用物品恢复${mpAmount}MP${outcome === 'CRITICAL_SUCCESS' ? '（大成功×1.5）' : ''}`,
      })
    }
  }

  // Attribute gain: +1 to custom dimension on SUCCESS or CRITICAL_SUCCESS
  if (
    scenarioEvent.triggered &&
    (outcome === 'SUCCESS' || outcome === 'CRITICAL_SUCCESS')
  ) {
    const label = CUSTOM_DICE_LABELS[scenarioEvent.diceType]
    effects.push({
      type: 'ATTRIBUTE_GAIN',
      customAttribute: scenarioEvent.diceType,
      delta: 1,
      reason: `${label}属性+1（成功完成${scenarioEvent.eventTitle}）`,
    })
  }

  // Special case: inCombat but player did a non-combat action (scenarioEvent not triggered)
  // → Player wastes their turn, NPC gets a free attack (as if FAILURE outcome)
  if (inCombat && !scenarioEvent.triggered && npcCombatStats) {
    const selectedAbility = chosenNpcAbility ?? null
    const isHealAction = selectedAbility !== null && selectedAbility.hp_restore > 0 && selectedAbility.damage === 0
    const isDrainAction = selectedAbility !== null && selectedAbility.hp_restore < 0 && selectedAbility.damage === 0

    if (isDrainAction) {
      const baseDrain = Math.abs(selectedAbility!.hp_restore)
      effects.push({
        type: 'HP_DELTA',
        delta: -baseDrain,
        reason: `NPC趁机使用「${selectedAbility!.name}」吸取${baseDrain}HP`,
      })
      if (selectedAbility!.mp_cost > 0) {
        effects.push({ type: 'NPC_MP_DELTA', npcId: npcCombatStats.npcId, delta: -selectedAbility!.mp_cost, reason: `NPC消耗${selectedAbility!.mp_cost}MP使用${selectedAbility!.name}` })
      }
    } else if (isHealAction) {
      effects.push({
        type: 'NPC_HP_DELTA',
        npcId: npcCombatStats.npcId,
        delta: selectedAbility!.hp_restore,
        reason: `NPC趁机使用「${selectedAbility!.name}」恢复${selectedAbility!.hp_restore}HP`,
      })
      if (selectedAbility!.mp_cost > 0) {
        effects.push({ type: 'NPC_MP_DELTA', npcId: npcCombatStats.npcId, delta: -selectedAbility!.mp_cost, reason: `NPC消耗${selectedAbility!.mp_cost}MP使用${selectedAbility!.name}` })
      }
    } else {
      // Normal attack — NPC gets full damage (as FAILURE)
      const rawNpcAtk = (selectedAbility && selectedAbility.damage > 0) ? selectedAbility.damage : (npcCombatStats.attack ?? 2)
      const pDef = playerTotalDEF ?? 0
      const netDmg = Math.max(1, rawNpcAtk - pDef)
      const abilityLabel = selectedAbility ? `「${selectedAbility.name}」` : '普通攻击'
      effects.push({
        type: 'HP_DELTA',
        delta: -netDmg,
        reason: `NPC趁机使用${abilityLabel}造成${netDmg}点伤害（ATK${rawNpcAtk} - DEF${pDef}）`,
      })
      if (selectedAbility && selectedAbility.mp_cost > 0) {
        effects.push({ type: 'NPC_MP_DELTA', npcId: npcCombatStats.npcId, delta: -selectedAbility.mp_cost, reason: `NPC消耗${selectedAbility.mp_cost}MP使用${selectedAbility.name}` })
      }
    }
    return effects
  }

  // Combat damage: when in active combat OR a COMBAT scenario event is triggered,
  // calculate dynamic damage based on NPC attack/abilities vs player armor, and track NPC HP when player hits.
  if (scenarioEvent.triggered && (scenarioEvent.diceType === 'COMBAT' || inCombat)) {
    // --- NPC attacks player (on player failure) ---
    // Use pre-selected ability from Node 6C agent (or null for basic attack)
    const selectedAbility = chosenNpcAbility ?? null
    const isHealAction = selectedAbility !== null && selectedAbility.hp_restore > 0 && selectedAbility.damage === 0
    const isDrainAction = selectedAbility !== null && selectedAbility.hp_restore < 0 && selectedAbility.damage === 0

    if (isDrainAction) {
      // --- Drain ability: hp_restore < 0 bypasses DEF (magical HP drain) ---
      // On SUCCESS the NPC still partially drains (25%), on CRITICAL_SUCCESS fully dodged (0)
      const baseDrain = Math.abs(selectedAbility!.hp_restore)
      const drainTable: Partial<Record<OutcomeType, number>> = {
        CRITICAL_FAILURE: -(baseDrain * 2),
        FAILURE:          -baseDrain,
        PARTIAL:          -Math.ceil(baseDrain / 2),
        SUCCESS:          -Math.max(1, Math.ceil(baseDrain * 0.25)),
        // CRITICAL_SUCCESS: 0 — player fully dodges drain
      }
      const drainDmg = drainTable[outcome]
      if (drainDmg) {
        effects.push({
          type: 'HP_DELTA',
          delta: drainDmg,
          reason: `被NPC「${selectedAbility!.name}」吸取${Math.abs(drainDmg)}HP（${outcome}）`,
        })
      }
      // Deduct NPC MP for drain ability — always consumed when ability is used
      if (selectedAbility!.mp_cost > 0 && npcCombatStats?.npcId) {
        effects.push({
          type: 'NPC_MP_DELTA',
          npcId: npcCombatStats.npcId,
          delta: -selectedAbility!.mp_cost,
          reason: `NPC消耗${selectedAbility!.mp_cost}MP使用${selectedAbility!.name}`,
        })
      }
    } else if (!isHealAction) {
      // --- Normal attack (physical ATK - DEF) ---
      // Skip attack when NPC chose to heal — healing costs the NPC its attack turn
      // On SUCCESS the NPC still grazes player for 25% damage; on CRITICAL_SUCCESS fully dodged
      const rawNpcAtk = (selectedAbility && selectedAbility.damage > 0) ? selectedAbility.damage : (npcCombatStats?.attack ?? 2)
      const abilityLabel = selectedAbility ? `「${selectedAbility.name}」` : '普通攻击'
      const pDef = playerTotalDEF ?? 0
      const netDmg = Math.max(1, rawNpcAtk - pDef)
      const dmgTable: Partial<Record<OutcomeType, number>> = {
        CRITICAL_FAILURE: -(netDmg * 2),                        // devastating hit
        FAILURE:          -netDmg,                               // solid hit
        PARTIAL:          -Math.ceil(netDmg / 2),                // mutual exchange
        SUCCESS:          -Math.max(1, Math.ceil(netDmg * 0.25)), // graze / counterattack residual
        // CRITICAL_SUCCESS: 0 — player fully dodges NPC attack
      }
      const playerDmg = dmgTable[outcome]
      if (playerDmg) {
        effects.push({
          type: 'HP_DELTA',
          delta: playerDmg,
          reason: `受到${Math.abs(playerDmg)}点战斗伤害（NPC使用${abilityLabel}，ATK${rawNpcAtk} - DEF${pDef}，${outcome}）`,
        })
      }

      // Deduct NPC MP for using ability — always consumed when ability is used
      if (selectedAbility && selectedAbility.mp_cost > 0 && npcCombatStats?.npcId) {
        effects.push({
          type: 'NPC_MP_DELTA',
          npcId: npcCombatStats.npcId,
          delta: -selectedAbility.mp_cost,
          reason: `NPC消耗${selectedAbility.mp_cost}MP使用${selectedAbility.name}`,
        })
      }
    }

    // --- NPC self-heal (when agent chose a healing ability) ---
    if (isHealAction && npcCombatStats?.npcId) {
      effects.push({
        type: 'NPC_HP_DELTA',
        npcId: npcCombatStats.npcId,
        delta: selectedAbility!.hp_restore,
        reason: `NPC使用「${selectedAbility!.name}」恢复${selectedAbility!.hp_restore}HP`,
      })
      // Deduct NPC MP for heal ability
      if (selectedAbility!.mp_cost > 0) {
        effects.push({
          type: 'NPC_MP_DELTA',
          npcId: npcCombatStats.npcId,
          delta: -selectedAbility!.mp_cost,
          reason: `NPC消耗${selectedAbility!.mp_cost}MP使用${selectedAbility!.name}`,
        })
      }
    }

    // --- Player attacks NPC (on success or partial) ---
    // PARTIAL: half damage (mutual exchange — both sides take reduced damage)
    // SUCCESS: full damage
    // CRITICAL_SUCCESS: double damage
    // SPELL_CAST: damage = ability_damage (magic bypasses physical DEF)
    // COMBAT/ITEM_USE(offensive): damage = max(1, playerATK - npcDEF)
    // ITEM_USE(healing):   NO damage — hp/mp restoration items don't attack NPCs
    const isHealingItem = intent.intent === 'ITEM_USE' && !!(usedItemStats?.hpRestore || usedItemStats?.mpRestore)
    const isPlayerAttack = !isHealingItem && (intent.intent === 'COMBAT' || intent.intent === 'SPELL_CAST' || intent.intent === 'ITEM_USE')
    if (isPlayerAttack && (outcome === 'SUCCESS' || outcome === 'CRITICAL_SUCCESS' || outcome === 'PARTIAL') && npcCombatStats?.npcId) {
      let netDmgToNpc: number
      let damageSource: string

      if (intent.intent === 'SPELL_CAST') {
        // Spell damage: ability_damage - npcDEF (independent from player ATK)
        const abilityDmg = playerAbilityDamage ?? 0
        const npcDef = npcCombatStats.defense ?? 0
        netDmgToNpc = Math.max(1, abilityDmg - npcDef)
        damageSource = `法术${abilityDmg} - DEF${npcDef}`
      } else {
        // Physical damage: ATK - DEF
        const pAtk = playerTotalATK ?? 2
        const npcDef = npcCombatStats.defense ?? 0
        netDmgToNpc = Math.max(1, pAtk - npcDef)
        damageSource = `ATK${pAtk} - DEF${npcDef}`
      }

      const multiplier = outcome === 'CRITICAL_SUCCESS' ? 2 : outcome === 'PARTIAL' ? 0.5 : 1
      const npcDmg = Math.max(1, Math.ceil(netDmgToNpc * multiplier))
      const label = outcome === 'CRITICAL_SUCCESS' ? ' ×2暴击' : outcome === 'PARTIAL' ? ' ×0.5擦伤' : ''
      effects.push({
        type: 'NPC_HP_DELTA',
        npcId: npcCombatStats.npcId,
        delta: -npcDmg,
        reason: `玩家对NPC造成${npcDmg}点伤害（${damageSource}${label}）`,
      })
    }
  }

  return effects
}

/**
 * Builds a human-readable narrative hint for the DM prompt.
 * Incorporates scenario event success/failure guidance.
 */
function buildNarrativeHint(
  outcome: OutcomeType,
  dice: DiceResolution,
  precondition: PreconditionResult,
  scenarioEvent: ScenarioEvent
): string {
  if (outcome === 'PRECONDITION_FAILED') {
    return precondition.failReason ?? '玩家当前无法执行这个行动。'
  }

  const rollInfo = dice.rollRequired
    ? ` (d12=${dice.rawRoll}+attr${dice.modifier}=${dice.total} vs DC ${dice.dc})`
    : ''

  // Use scenario event guidance when available
  if (scenarioEvent.triggered) {
    const label = CUSTOM_DICE_LABELS[scenarioEvent.diceType]
    switch (outcome) {
      case 'CRITICAL_SUCCESS':
        return `【大成功】${label}骰${rollInfo}。${scenarioEvent.successNarrative} 超预期的出色表现，描述令人印象深刻的结果。`
      case 'SUCCESS':
        return `【成功】${label}骰${rollInfo}。${scenarioEvent.successNarrative}`
      case 'PARTIAL':
        return `【勉强成功】${label}骰${rollInfo}。玩家以代价换取了成功——描述成功但伴随复杂情况的结果。`
      case 'FAILURE':
        return `【失败】${label}骰${rollInfo}。${scenarioEvent.failureNarrative}`
      case 'CRITICAL_FAILURE':
        return `【大失败】${label}骰${rollInfo}。${scenarioEvent.failureNarrative} 情况急剧恶化，描述戏剧性的灾难性后果。`
      default:
        return `玩家尝试行动${rollInfo}。`
    }
  }

  // Generic fallback when no scenario event
  const genericDescriptions: Record<OutcomeType, string> = {
    CRITICAL_SUCCESS: `【大成功】玩家的行动取得了超乎预期的成功${rollInfo}。描述一个令人印象深刻的、超出预期的结果。`,
    SUCCESS: `【成功】玩家的行动成功了${rollInfo}。自然地描述成功的结果。`,
    PARTIAL: `【勉强成功】玩家的行动勉强成功${rollInfo}。描述一个成功但伴随代价或复杂情况的结果。`,
    FAILURE: `【失败】玩家的行动失败了${rollInfo}。描述失败的后果，但保持故事继续推进。`,
    CRITICAL_FAILURE: `【大失败】玩家的行动灾难性地失败了${rollInfo}。描述一个戏剧性的失败和严重后果。`,
    PRECONDITION_FAILED: '',
  }

  return genericDescriptions[outcome] ?? '玩家尝试了他的行动。'
}

/**
 * Synthesizes the final outcome from precondition, dice, and scenario event.
 */
export function synthesizeOutcome(
  input: OutcomeSynthesizerInput
): OutcomeSynthesis {
  const { intent, precondition, dice, scenarioEvent, npcCombatStats, npcAbilities, chosenNpcAbility, playerTotalATK, playerTotalDEF, playerAbilityDamage, playerAbilityMpCost, inCombat, usedItemStats } = input

  try {
    // Precondition failure bypasses dice entirely — but in combat,
    // the NPC still gets a free attack (player wasted their turn)
    if (!precondition.canProceed) {
      const effects: MechanicalEffect[] = []
      if (inCombat && npcCombatStats) {
        const selectedAbility = chosenNpcAbility ?? null
        const isHealAction = selectedAbility !== null && selectedAbility.hp_restore > 0 && selectedAbility.damage === 0
        const isDrainAction = selectedAbility !== null && selectedAbility.hp_restore < 0 && selectedAbility.damage === 0

        if (isDrainAction) {
          const baseDrain = Math.abs(selectedAbility!.hp_restore)
          effects.push({ type: 'HP_DELTA', delta: -baseDrain, reason: `NPC趁机使用「${selectedAbility!.name}」吸取${baseDrain}HP` })
          if (selectedAbility!.mp_cost > 0) {
            effects.push({ type: 'NPC_MP_DELTA', npcId: npcCombatStats.npcId, delta: -selectedAbility!.mp_cost, reason: `NPC消耗${selectedAbility!.mp_cost}MP` })
          }
        } else if (isHealAction) {
          effects.push({ type: 'NPC_HP_DELTA', npcId: npcCombatStats.npcId, delta: selectedAbility!.hp_restore, reason: `NPC趁机使用「${selectedAbility!.name}」恢复${selectedAbility!.hp_restore}HP` })
          if (selectedAbility!.mp_cost > 0) {
            effects.push({ type: 'NPC_MP_DELTA', npcId: npcCombatStats.npcId, delta: -selectedAbility!.mp_cost, reason: `NPC消耗${selectedAbility!.mp_cost}MP` })
          }
        } else {
          const rawNpcAtk = (selectedAbility && selectedAbility.damage > 0) ? selectedAbility.damage : (npcCombatStats.attack ?? 2)
          const pDef = playerTotalDEF ?? 0
          const netDmg = Math.max(1, rawNpcAtk - pDef)
          const abilityLabel = selectedAbility ? `「${selectedAbility.name}」` : '普通攻击'
          effects.push({ type: 'HP_DELTA', delta: -netDmg, reason: `NPC趁机使用${abilityLabel}造成${netDmg}点伤害（ATK${rawNpcAtk} - DEF${pDef}）` })
          if (selectedAbility && selectedAbility.mp_cost > 0) {
            effects.push({ type: 'NPC_MP_DELTA', npcId: npcCombatStats.npcId, delta: -selectedAbility.mp_cost, reason: `NPC消耗${selectedAbility.mp_cost}MP` })
          }
        }
        console.log(`[Node 6 · Outcome] PRECONDITION_FAILED (战斗中) → NPC趁机攻击, effects=${effects.length}`)
      }
      return {
        outcome: 'PRECONDITION_FAILED',
        mechanicalEffects: effects,
        narrativeHint: precondition.failReason ?? '行动被前置条件阻止。',
      }
    }

    const outcome = determineOutcomeType(dice)
    const mechanicalEffects = deriveMechanicalEffects(intent, outcome, precondition, scenarioEvent, npcCombatStats, npcAbilities, chosenNpcAbility, playerTotalATK, playerTotalDEF, playerAbilityDamage, playerAbilityMpCost, inCombat, usedItemStats)
    const narrativeHint = buildNarrativeHint(outcome, dice, precondition, scenarioEvent)

    console.log(
      `[Node 6 · Outcome] outcome=${outcome} effects=${mechanicalEffects.length}` +
      (scenarioEvent.triggered ? ` attrGain=${scenarioEvent.diceType}` : '')
    )

    return { outcome, mechanicalEffects, narrativeHint }

  } catch (error) {
    console.error('[Node 6 · Outcome] 出错，使用回退值:', error)
    return { ...FALLBACK_OUTCOME }
  }
}
