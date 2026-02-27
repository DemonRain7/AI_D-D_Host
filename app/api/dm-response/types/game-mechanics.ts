/**
 * Game Mechanics Types
 *
 * Defines dice rolling, outcomes, and mechanical effects used by
 * the Dice Engine and Outcome Synthesizer agents.
 */

export type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100'

export type DiceRoll = {
  dieType: DieType
  count: number
  individualRolls: number[]  // Each die's result
  result: number             // Sum of all dice
  modifier: number           // Stat modifier (e.g., +3 from STR)
  total: number              // result + modifier
  purpose: string            // "attack roll", "damage", "saving throw", etc.
}

/**
 * Final outcome of a player action after preconditions + dice resolution.
 * PRECONDITION_FAILED means the action was blocked before dice were rolled.
 */
export type OutcomeType =
  | 'CRITICAL_SUCCESS'    // Natural 20 or exceeded DC by 10+
  | 'SUCCESS'             // Roll + modifier >= DC
  | 'PARTIAL'             // Missed DC by 1-5 (success with cost)
  | 'FAILURE'             // Missed DC by more than 5
  | 'CRITICAL_FAILURE'    // Natural 1
  | 'PRECONDITION_FAILED' // No item / no spell slots / action impossible

/**
 * A single mechanical state change resulting from the action outcome.
 * Used by state update nodes (11-15) to apply changes.
 */
export type MechanicalEffect = {
  type:
    | 'HP_DELTA'            // Change to HP (positive = heal, negative = damage)
    | 'MP_DELTA'            // Change to MP/mana
    | 'NPC_HP_DELTA'        // Change to NPC HP (negative = damage dealt by player)
    | 'NPC_MP_DELTA'        // Change to NPC MP (negative = ability cost consumed)
    | 'ITEM_CONSUMED'       // Item removed from inventory
    | 'ITEM_GAINED'         // Item added to inventory
    | 'STATUS_ADD'          // Status effect applied (poisoned, blessed, etc.)
    | 'STATUS_REMOVE'       // Status effect removed
    | 'SPELL_SLOT_USED'     // Spell slot consumed
    | 'GOLD_DELTA'          // Gold gained/lost
    | 'XP_DELTA'            // Experience gained
    | 'NPC_ATTITUDE_DELTA'  // NPC relationship change
    | 'CUSTOM_FIELD_DELTA'  // Generic custom player field change
    | 'ATTRIBUTE_GAIN'      // Custom dimension attribute +1 (战斗/游说/混沌/道德/才智)
  targetField?: string      // For CUSTOM_FIELD_DELTA: field name
  delta?: number            // Numeric change amount
  itemId?: string           // For ITEM_CONSUMED/GAINED: item ID
  itemName?: string         // For ITEM_CONSUMED/GAINED: item name (denormalized)
  statusName?: string       // For STATUS_ADD/REMOVE: effect name
  statusEffectType?: 'buff' | 'debuff' | 'neutral'  // For STATUS_ADD: classification
  statusDescription?: string  // For STATUS_ADD: flavor text
  statusDuration?: number     // For STATUS_ADD: turns remaining (undefined = indefinite)
  statusSourceName?: string   // For STATUS_ADD: which NPC/ability/item applied it
  npcId?: string            // For NPC_ATTITUDE_DELTA / NPC_HP_DELTA: NPC ID
  customAttribute?: string  // For ATTRIBUTE_GAIN: which dimension (COMBAT/PERSUASION/etc.)
  reason: string            // Human-readable explanation
}

export type PreconditionResult = {
  canProceed: boolean
  result: 'PASSED' | 'FAILED' | 'PARTIAL'
  failReason?: string
  weaponStats?: {
    weaponName: string
    attackBonus: number
    damageDice: string
  }
  spellInfo?: {
    slotLevel: number
    attackBonus: number
    saveDC: number
  }
  /** When a SOCIAL+learning request is validated, carries the ability info for mechanical granting */
  learningAbility?: {
    abilityId: string
    abilityName: string
  }
}

export type DiceResolution = {
  rollRequired: boolean
  rolls: DiceRoll[]
  rawRoll: number    // The primary die result (before modifier)
  modifier: number
  total: number
  dc: number | null  // The difficulty class being targeted
  succeeded: boolean | null
  isCriticalSuccess: boolean
  isCriticalFailure: boolean
}

export type OutcomeSynthesis = {
  outcome: OutcomeType
  mechanicalEffects: MechanicalEffect[]
  narrativeHint: string  // Brief description for the DM prompt
}

export const FALLBACK_PRECONDITION: PreconditionResult = {
  canProceed: true,
  result: 'PASSED',
}

export const FALLBACK_DICE: DiceResolution = {
  rollRequired: false,
  rolls: [],
  rawRoll: 0,
  modifier: 0,
  total: 0,
  dc: null,
  succeeded: null,
  isCriticalSuccess: false,
  isCriticalFailure: false,
}

export const FALLBACK_OUTCOME: OutcomeSynthesis = {
  outcome: 'SUCCESS',
  mechanicalEffects: [],
  narrativeHint: 'The player attempts their action.',
}
