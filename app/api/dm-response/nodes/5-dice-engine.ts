/**
 * NODE 5: Dice Engine (Custom 5-Dimension System)
 *
 * Rolls d12 + player's attribute value vs the scenario event's DC.
 * The ScenarioEvent (from Node 3C) determines:
 *   - WHETHER a roll is needed this turn
 *   - WHICH of the 5 custom dimensions is tested
 *   - WHAT the DC is
 *
 * Player's custom attribute is the modifier (starts 0, grows +1 per success).
 * Uses crypto.getRandomValues() — never LLM-decided.
 *
 * Fallback: rollRequired=false on any error or when event not triggered.
 *
 * Outcome thresholds (d12 scale):
 *   Natural 1              → CRITICAL_FAILURE
 *   Natural 12             → CRITICAL_SUCCESS
 *   total ≥ DC + 4         → CRITICAL_SUCCESS
 *   DC ≤ total < DC + 4    → SUCCESS
 *   DC - 2 ≤ total < DC    → PARTIAL
 *   total < DC - 2         → FAILURE
 */

import { rollDice, isCriticalSuccess, isCriticalFailure } from '@/lib/dice/roller'
import type { PreconditionResult, DiceResolution } from '../types/game-mechanics'
import { FALLBACK_DICE } from '../types/game-mechanics'
import type { PlayerState } from '../types/player-state'
import type { ScenarioEvent } from '../types/custom-dice'
import { getCustomAttributeValue, CUSTOM_DICE_LABELS } from '../types/custom-dice'

export type DiceEngineInput = {
  precondition: PreconditionResult
  playerState: PlayerState
  scenarioEvent: ScenarioEvent   // From Node 3C
}

/**
 * Resolves dice for the current turn using the custom 5-dimension system.
 *
 * Returns FALLBACK_DICE (no roll) when:
 *   - Precondition failed (action blocked before dice)
 *   - ScenarioEvent.triggered === false (mundane action, auto-success)
 */
export async function resolveDice(
  input: DiceEngineInput
): Promise<DiceResolution> {
  const { precondition, playerState, scenarioEvent } = input

  // Precondition failed → skip dice entirely
  if (!precondition.canProceed) {
    return { ...FALLBACK_DICE }
  }

  // Scenario event not triggered → no dice check this turn
  if (!scenarioEvent.triggered) {
    return { ...FALLBACK_DICE }
  }

  try {
    const { diceType, dc, eventTitle } = scenarioEvent

    // Modifier = player's attribute value for this dice type
    const attributeValue = getCustomAttributeValue(diceType, playerState.customAttributes)
    const dimensionLabel = CUSTOM_DICE_LABELS[diceType]

    const purpose = `${eventTitle} [${dimensionLabel}属性 d12+${attributeValue} vs DC ${dc}]`
    const roll = rollDice(1, 'd12', attributeValue, purpose)

    const critSuccess = isCriticalSuccess(roll)
    const critFail = isCriticalFailure(roll)
    const succeeded = critSuccess ? true : critFail ? false : roll.total >= dc

    console.log(
      `[Node 5 · Dice] ${dimensionLabel}(${diceType}): d12=${roll.individualRolls[0]} +attr${attributeValue} = ${roll.total} vs DC ${dc} → ${
        critSuccess ? 'CRIT SUCCESS' : critFail ? 'CRIT FAIL' : succeeded ? 'SUCCESS' : 'FAILURE'
      }`
    )

    return {
      rollRequired: true,
      rolls: [roll],
      rawRoll: roll.individualRolls[0],
      modifier: attributeValue,
      total: roll.total,
      dc,
      succeeded,
      isCriticalSuccess: critSuccess,
      isCriticalFailure: critFail,
    }

  } catch (error) {
    console.error('[Node 5 · Dice] 出错，返回无骰子回退:', error)
    return { ...FALLBACK_DICE }
  }
}
