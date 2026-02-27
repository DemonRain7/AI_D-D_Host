/**
 * Custom 5-Dimension Dice System
 *
 * Replaces D&D standard stats for dice resolution.
 * Five dice types correspond to five player attribute dimensions.
 *
 * Dice formula: d12 roll (1-12) + attribute_value vs DC
 * On success: attribute_value += 1 (growth through action)
 *
 * Dimension mapping:
 *   COMBAT     (战斗) — Physical fighting, violence, defense
 *   PERSUASION (游说) — Social manipulation, negotiation, deception
 *   CHAOS      (混沌) — Unpredictable actions, risk-taking, wild moves
 *   CHARM      (魅力) — Seduction, flirting, personal magnetism, attracting others
 *   WIT        (才智) — Strategy, puzzles, knowledge, clever planning
 */

/**
 * The five custom dice types.
 */
export type CustomDiceType =
  | 'COMBAT'      // 战斗
  | 'PERSUASION'  // 游说
  | 'CHAOS'       // 混沌
  | 'CHARM'       // 魅力
  | 'WIT'         // 才智

/**
 * Player's accumulated attribute values across the 5 dimensions.
 * Starts at 0, increases by 1 each time a corresponding event is succeeded.
 */
export type CustomAttributes = {
  combat: number      // 战斗属性值
  persuasion: number  // 游说属性值
  chaos: number       // 混沌属性值
  charm: number       // 魅力属性值
  wit: number         // 才智属性值
}

/**
 * A scenario-generated dice challenge event.
 * Created by Node 3C (ScenarioEventGenerator) each turn.
 *
 * If triggered=false, no dice check occurs this turn.
 * If triggered=true, diceType + dc determine the check.
 */
export type ScenarioEvent = {
  triggered: boolean        // Whether a dice check is warranted this turn
  diceType: CustomDiceType  // Which of the 5 attributes is checked
  dc: number                // Difficulty Class (4=easy, 6=normal, 8=hard, 10=very hard)
  eventTitle: string        // Short title e.g. "Combat Challenge"
  eventDescription: string  // Brief description of the challenge the player faces
  successNarrative: string  // Narrative hint for DM on success
  failureNarrative: string  // Narrative hint for DM on failure
}

/**
 * Retrieves the numeric attribute value for a given dice type.
 */
export function getCustomAttributeValue(
  diceType: CustomDiceType,
  attrs: CustomAttributes
): number {
  switch (diceType) {
    case 'COMBAT':     return attrs.combat
    case 'PERSUASION': return attrs.persuasion
    case 'CHAOS':      return attrs.chaos
    case 'CHARM':      return attrs.charm
    case 'WIT':        return attrs.wit
  }
}

/**
 * Human-readable Chinese label for each dice type.
 */
export const CUSTOM_DICE_LABELS: Record<CustomDiceType, string> = {
  COMBAT:     '战斗',
  PERSUASION: '游说',
  CHAOS:      '混沌',
  CHARM:      '魅力',
  WIT:        '才智',
}

export const DEFAULT_CUSTOM_ATTRIBUTES: CustomAttributes = {
  combat: 0,
  persuasion: 0,
  chaos: 0,
  charm: 0,
  wit: 0,
}

export const NULL_SCENARIO_EVENT: ScenarioEvent = {
  triggered: false,
  diceType: 'WIT',
  dc: 0,
  eventTitle: '',
  eventDescription: '',
  successNarrative: '',
  failureNarrative: '',
}
