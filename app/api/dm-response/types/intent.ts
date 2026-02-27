/**
 * Intent Classification Types
 *
 * Defines the possible player action types and the structured output
 * of the Intent Classifier agent.
 */

export type IntentType =
  | 'COMBAT'      // Attacking, fighting, striking, defending
  | 'SPELL_CAST'  // Casting spells, using magic, incantations
  | 'ITEM_USE'    // Using, consuming, or activating an item
  | 'EXPLORE'     // Looking around, searching, moving, examining
  | 'SOCIAL'      // Talking to NPCs, negotiating, persuading, deceiving
  | 'NARRATIVE'   // Asking about the world/story, roleplaying dialogue
  | 'META'        // Out-of-character questions about rules or help

export type IntentClassification = {
  intent: IntentType
  confidence: number           // 0.0 - 1.0
  mentionedEntities: string[]  // Entity names extracted from player message
  targetEntity?: string        // Primary target of the action (NPC/item name)
  isBatchAction?: boolean      // True when player targets multiple/all items (e.g. "拾取所有物品", "全部装备")
  rawMessage: string           // Original player message
}

export const FALLBACK_INTENT: IntentClassification = {
  intent: 'NARRATIVE',
  confidence: 0.5,
  mentionedEntities: [],
  rawMessage: '',
}
