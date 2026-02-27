/**
 * Dice Roller Utility
 *
 * Uses crypto.getRandomValues() for cryptographically strong randomness.
 * This ensures dice rolls are truly random, NOT decided by an LLM.
 */

import type { DieType, DiceRoll } from '@/app/api/dm-response/types/game-mechanics'

const DIE_SIDES: Record<DieType, number> = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
  d100: 100,
}

/**
 * Roll a single die with unbiased uniform distribution.
 * Uses rejection sampling to avoid modulo bias.
 */
export function rollDie(dieType: DieType): number {
  const sides = DIE_SIDES[dieType]
  const array = new Uint32Array(1)

  // Rejection sampling: ensures uniform distribution
  const limit = Math.floor(0xffffffff / sides) * sides
  let value: number
  do {
    crypto.getRandomValues(array)
    value = array[0]
  } while (value >= limit)

  return (value % sides) + 1
}

/**
 * Roll multiple dice and return detailed results.
 */
export function rollDice(
  count: number,
  dieType: DieType,
  modifier: number,
  purpose: string
): DiceRoll {
  const individualRolls: number[] = []
  for (let i = 0; i < count; i++) {
    individualRolls.push(rollDie(dieType))
  }
  const result = individualRolls.reduce((sum, r) => sum + r, 0)

  return {
    dieType,
    count,
    individualRolls,
    result,
    modifier,
    total: result + modifier,
    purpose,
  }
}

/**
 * Roll a d20 with modifier (standard skill/attack check).
 */
export function rollD20Check(modifier: number, purpose: string): DiceRoll {
  return rollDice(1, 'd20', modifier, purpose)
}

/**
 * Determine if a roll is a natural maximum (critical success).
 * Works for any die type: d12 max=12, d20 max=20, etc.
 */
export function isCriticalSuccess(roll: DiceRoll): boolean {
  if (roll.count !== 1) return false
  const maxValue = DIE_SIDES[roll.dieType]
  return roll.individualRolls[0] === maxValue
}

/**
 * Determine if a roll is a natural 1 (critical failure).
 * Universal across all die types.
 */
export function isCriticalFailure(roll: DiceRoll): boolean {
  return roll.count === 1 && roll.individualRolls[0] === 1
}
