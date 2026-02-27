/**
 * NODE 4: Precondition Validator
 *
 * Validates that the player CAN perform the intended action before
 * rolling dice or generating narrative. Four independent micro-agents
 * run in parallel, each responsible for one type of check.
 *
 * Strict name matching:
 *   - COMBAT:     target must exactly match an entity in interactive_hints
 *   - ITEM_USE:   item name must exactly match an item in player inventory
 *   - SPELL_CAST: ability name must exactly match an ability in player inventory
 *
 * "Exact" means: strip 「」brackets, trim whitespace, case-insensitive compare.
 *
 * Fallback: returns canProceed=true on any error (never blocks the game).
 */

import type { IntentClassification } from '../types/intent'
import type { PreconditionResult } from '../types/game-mechanics'
import { FALLBACK_PRECONDITION } from '../types/game-mechanics'
import type { PlayerState } from '../types/player-state'
import type { StoryState } from './3e-story-state-loader'

// ============================================================================
// Shared: Strict Name Normalizer
// ============================================================================

/**
 * Normalizes a name for exact matching:
 *   - Strips brackets 「」【】() etc.
 *   - Strips middle dots · • ・ (common in NPC names like "裁判·奥斯卡")
 *   - Removes all whitespace
 *   - Lowercases
 */
function normalizeName(s: string): string {
  return s
    .replace(/[「」『』【】\[\]()（）·•・\-—]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/**
 * Strict exact match: two names are equal after normalization.
 */
function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b)
}

// ============================================================================
// Micro-Agent A: Inventory Checker (ITEM_USE — strict match)
// ============================================================================

/**
 * Checks if the player has the mentioned item in their inventory
 * OR if it's available at the current location (pickup action).
 * Uses strict exact name matching.
 * Batch actions (intent.isBatchAction) bypass individual item matching.
 */
function checkInventory(
  intent: IntentClassification,
  playerState: PlayerState,
  locationItemNames?: string[]
): PreconditionResult {
  if (intent.intent !== 'ITEM_USE') return { canProceed: true, result: 'PASSED' }

  const mentionedItem = intent.targetEntity ?? intent.mentionedEntities[0]
  if (!mentionedItem) return { canProceed: true, result: 'PASSED' }

  // Batch action: "拾取所有物品" / "全部拿走" / "把东西都收了"
  // Determined by Node 2B (LLM or pattern match). Pass if there are items available.
  if (intent.isBatchAction) {
    const items = playerState.inventory.filter(inv => inv.slotType !== 'ability')
    const hasLocationItems = locationItemNames && locationItemNames.length > 0
    const hasInventoryItems = items.length > 0
    if (hasLocationItems || hasInventoryItems) {
      console.log(`[Node 4 · Precondition] 批量操作 (isBatchAction=true) → 放行 (地点物品=${locationItemNames?.length ?? 0}, 背包=${items.length})`)
      return { canProceed: true, result: 'PASSED' }
    }
    return {
      canProceed: false,
      result: 'FAILED',
      failReason: '你环顾四周，这里没有什么可以拾取的东西，背包里也没有可用的物品。',
    }
  }

  // Only check against non-ability items
  const items = playerState.inventory.filter(inv => inv.slotType !== 'ability')

  const item = items.find(inv => namesMatch(inv.itemName, mentionedItem))

  if (!item) {
    // Not in inventory — check if it's on the ground at current location (pickup action)
    if (locationItemNames && locationItemNames.some(name => namesMatch(name, mentionedItem))) {
      console.log(`[Node 4 · Precondition] 「${mentionedItem}」不在背包中，但在当前地点可拾取 → 放行`)
      return { canProceed: true, result: 'PASSED' }
    }

    const available = items.map(i => `「${i.itemName}」`).join('、') || '空'
    console.log(`[Node 4 · Precondition] 物品匹配失败: 「${mentionedItem}」不在背包中也不在当前地点。背包: ${available}`)
    return {
      canProceed: false,
      result: 'FAILED',
      failReason: `你的背包里没有「${mentionedItem}」，附近也没有看到这个物品。`,
    }
  }

  if (item.quantity <= 0) {
    return {
      canProceed: false,
      result: 'FAILED',
      failReason: `你的「${item.itemName}」已经用完了。`,
    }
  }

  return { canProceed: true, result: 'PASSED' }
}

// ============================================================================
// Micro-Agent B: Spell/Ability Checker (SPELL_CAST — strict match)
// ============================================================================

/**
 * For SPELL_CAST: checks if the mentioned ability/spell exists in
 * the player's inventory (slot_type='ability'). Uses strict name matching.
 * Also checks spell slots if tracked.
 */
function checkSpellSlots(
  intent: IntentClassification,
  playerState: PlayerState
): PreconditionResult {
  if (intent.intent !== 'SPELL_CAST') return { canProceed: true, result: 'PASSED' }

  // Check ability name against inventory abilities.
  // For SPELL_CAST, targetEntity is typically the NPC target (e.g. "幻影刺客"),
  // NOT the spell name. The spell name is in mentionedEntities.
  // Strategy: find the first mentionedEntity that matches a known ability.
  const abilities = playerState.inventory.filter(inv => inv.slotType === 'ability')

  if (abilities.length > 0) {
    // Collect all candidate names: mentionedEntities + targetEntity
    const candidates = [...intent.mentionedEntities, ...(intent.targetEntity ? [intent.targetEntity] : [])]

    // Find the first candidate that matches a known ability
    const matchedAbility = candidates.find(c =>
      abilities.some(a => namesMatch(a.itemName, c))
    )

    if (!matchedAbility) {
      // None of the mentioned entities match a known ability
      const abilityNames = candidates.filter(c =>
        // Exclude names that look like NPC targets (exist in non-ability context)
        !abilities.some(a => namesMatch(a.itemName, c))
      )
      const bestGuess = abilityNames[0] ?? candidates[0] ?? '未知技能'
      const available = abilities.map(a => `「${a.itemName}」`).join('、')
      console.log(`[Node 4 · Precondition] 技能匹配失败: 提及的「${candidates.join('」「')}」均不在已知技能中。已知: ${available}`)
      return {
        canProceed: false,
        result: 'FAILED',
        failReason: `你还没有掌握「${bestGuess}」这个技能。`,
      }
    }

    console.log(`[Node 4 · Precondition] 技能匹配成功: 「${matchedAbility}」`)
  }

  // Spell info for dice engine (no spell slot checking — world module extension)
  return {
    canProceed: true,
    result: 'PASSED',
    spellInfo: {
      slotLevel: 1,
      attackBonus: 2 + playerState.customAttributes.wit,
      saveDC: 8 + playerState.customAttributes.wit,
    },
  }
}

// ============================================================================
// Micro-Agent C: Ability/Weapon Validator
// ============================================================================

/**
 * Checks combat readiness and resolves weapon stats.
 * Always allows unarmed combat; equipped weapons provide better bonuses.
 */
function checkAbilityAndWeapon(
  intent: IntentClassification,
  playerState: PlayerState
): PreconditionResult {
  if (intent.intent !== 'COMBAT') return { canProceed: true, result: 'PASSED' }

  const equippedWeapon = playerState.inventory.find(
    inv => inv.equipped && (inv.slotType === 'weapon_1' || inv.slotType === 'weapon_2')
  )

  if (equippedWeapon) {
    return {
      canProceed: true,
      result: 'PASSED',
      weaponStats: {
        weaponName: equippedWeapon.itemName,
        attackBonus: playerState.attack,
        damageDice: (equippedWeapon.customProperties?.['damageDice'] as string) ?? '1d8',
      },
    }
  }

  // Unarmed strike
  return {
    canProceed: true,
    result: 'PASSED',
    weaponStats: {
      weaponName: '徒手攻击',
      attackBonus: playerState.attack,
      damageDice: '1d4',
    },
  }
}

// ============================================================================
// Micro-Agent D: Scene Coherence Checker (COMBAT / SPELL_CAST — target only)
// ============================================================================

/**
 * For COMBAT and SPELL_CAST: checks if the **targetEntity** (the NPC being
 * attacked) exists in the current scene.
 *
 * Only checks targetEntity — NOT all mentionedEntities, because:
 *   - Ability/spell names (火球术) are validated by checkSpellSlots
 *   - Item/weapon names (雷电之戒) are validated by checkInventory
 *   - Only the attack target (NPC) needs scene presence verification
 *
 * Scene sources:
 *   1. interactive_hints from active story nodes (static scene objects)
 *   2. World NPC names from RAG (dynamic — NPCs may appear via story events)
 */
function checkSceneCoherence(
  intent: IntentClassification,
  storyState: StoryState | null,
  worldNpcNames?: string[]
): PreconditionResult {
  if (intent.intent !== 'COMBAT' && intent.intent !== 'SPELL_CAST') {
    return { canProceed: true, result: 'PASSED' }
  }

  // Only check targetEntity (the NPC target), not ability/item names
  const targetToCheck = intent.targetEntity
  if (!targetToCheck) return { canProceed: true, result: 'PASSED' }

  // If no story state or no active nodes, allow (fallback permissive)
  if (!storyState || !storyState.initialized || storyState.activeNodes.length === 0) {
    return { canProceed: true, result: 'PASSED' }
  }

  // Collect all interactive hints from active nodes
  const sceneEntities: string[] = []
  for (const node of storyState.activeNodes) {
    if (node.interactive_hints && node.interactive_hints.length > 0) {
      sceneEntities.push(...node.interactive_hints)
    }
  }

  // Also include world NPCs found by RAG — NPCs can appear dynamically
  // through story events and won't be in static interactive_hints
  if (worldNpcNames && worldNpcNames.length > 0) {
    sceneEntities.push(...worldNpcNames)
  }

  // If no hints defined, allow (world creator didn't define scene objects)
  if (sceneEntities.length === 0) return { canProceed: true, result: 'PASSED' }

  const found = sceneEntities.some(entity => namesMatch(entity, targetToCheck))
  if (!found) {
    console.log(`[Node 4 · Precondition] 场景匹配失败: 「${targetToCheck}」不在当前场景中。场景实体: [${sceneEntities.join(', ')}], 世界NPC: [${worldNpcNames?.join(', ') ?? '无'}]`)
    return {
      canProceed: false,
      result: 'FAILED',
      failReason: `你环顾四周，但这里并没有「${targetToCheck}」。`,
    }
  }

  return { canProceed: true, result: 'PASSED' }
}

// ============================================================================
// Main Validator: Runs All Micro-Agents
// ============================================================================

export type PreconditionValidatorInput = {
  intent: IntentClassification
  playerState: PlayerState
  storyState?: StoryState | null
  /** Item names available at the player's current location (for pickup validation) */
  locationItemNames?: string[]
  /** NPC names from RAG/world data — used by scene coherence to accept dynamically-spawned NPCs */
  worldNpcNames?: string[]
}

/**
 * Runs all four micro-agents in parallel and merges their results.
 * If any agent returns FAILED, the overall result is FAILED.
 * Fallback: canProceed=true on any uncaught error.
 */
export async function validatePreconditions(
  input: PreconditionValidatorInput
): Promise<PreconditionResult> {
  const { intent, playerState, storyState, locationItemNames, worldNpcNames } = input

  try {
    // All four micro-agents run concurrently
    const [inventoryResult, spellResult, abilityResult, sceneResult] = await Promise.all([
      Promise.resolve(checkInventory(intent, playerState, locationItemNames)).catch(() => FALLBACK_PRECONDITION),
      Promise.resolve(checkSpellSlots(intent, playerState)).catch(() => FALLBACK_PRECONDITION),
      Promise.resolve(checkAbilityAndWeapon(intent, playerState)).catch(() => FALLBACK_PRECONDITION),
      Promise.resolve(checkSceneCoherence(intent, storyState ?? null, worldNpcNames)).catch(() => FALLBACK_PRECONDITION),
    ])

    // If any check fails, return that failure (scene coherence checked first — highest priority)
    for (const result of [sceneResult, inventoryResult, spellResult, abilityResult]) {
      if (!result.canProceed) {
        console.log(`[Node 4 · Precondition] 失败: ${result.failReason}`)
        return result
      }
    }

    // Merge successful results (carry weapon/spell info forward)
    const merged: PreconditionResult = {
      canProceed: true,
      result: 'PASSED',
      weaponStats: abilityResult.weaponStats,
      spellInfo: spellResult.spellInfo,
    }

    console.log(`[Node 4 · Precondition] 通过 - 武器=${merged.weaponStats?.weaponName ?? '无'} 法术位=${merged.spellInfo?.slotLevel ?? '无'}`)
    return merged

  } catch (error) {
    console.error('[Node 4 · Precondition] 意外错误，使用回退值:', error)
    return { ...FALLBACK_PRECONDITION }
  }
}
