/**
 * NODE 0: Action Validity Gate
 *
 * Pre-pipeline validation that checks whether the player's action references
 * an item/entity that actually exists and is accessible. Runs BEFORE the
 * full LLM pipeline to prevent hallucinated item pickups.
 *
 * Two outcomes:
 *   1. PASS        — action is valid, continue pipeline normally
 *   2. BLOCKED     — item doesn't exist, is inaccessible, or is locked → short-circuit with rejection
 *
 * Only activates for ITEM_USE intent. Other intents pass through freely.
 */

import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import { MODEL_FAST } from '@/lib/config'

// ── Types ──────────────────────────────────────────────────────────────────

export type ValidityGateInput = {
  playerMessage: string
  intent: string
  sessionId: string
  worldId: string
  currentLocationId: string | null
  currentLocationName: string | null
  unlockedNodeIds: Set<string>
  supabase: SupabaseClient
  openai: OpenAI
}

export type ValidityGateResult = {
  blocked: boolean
  rejectionMessage?: string
}

// ── Tool Definition ────────────────────────────────────────────────────────

const VALIDATE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'validate_action',
    description: 'Validate whether the player action references an accessible item.',
    parameters: {
      type: 'object',
      properties: {
        references_item: {
          type: 'boolean',
          description: 'Does the player message reference a specific item, equipment, or consumable they want to pick up, use, or interact with?',
        },
        referenced_name: {
          type: 'string',
          description: 'The item name the player is referring to, in their own words.',
        },
        match_result: {
          type: 'string',
          enum: ['accessible', 'locked', 'not_found', 'no_item_reference'],
          description: 'accessible = matches an item in the accessible list; locked = matches a locked item; not_found = no match in any list; no_item_reference = player is not trying to interact with a specific item.',
        },
        matched_item_name: {
          type: 'string',
          description: 'The exact name from the provided lists that best matches what the player referenced. Empty if not_found.',
        },
      },
      required: ['references_item', 'referenced_name', 'match_result'],
    },
  },
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.replace(/[「」『』【】\[\]()（）\s]/g, '').toLowerCase()
}

/** Quick substring match: does `msg` contain `name` or vice-versa? */
function fuzzyContains(msg: string, name: string): boolean {
  const a = normalize(msg)
  const b = normalize(name)
  return a.includes(b) || b.includes(a)
}

// ── Main Function ──────────────────────────────────────────────────────────

export async function validateActionValidity(
  input: ValidityGateInput
): Promise<ValidityGateResult> {
  const {
    playerMessage, intent, sessionId, worldId,
    currentLocationId, currentLocationName, unlockedNodeIds,
    supabase, openai,
  } = input

  // Only gate ITEM_USE actions — other intents pass freely
  if (intent !== 'ITEM_USE') {
    return { blocked: false }
  }

  // ── 1. Collect all known items ────────────────────────────────────────

  // 1a. Player inventory (owned items — always accessible)
  const { data: inventoryRows } = await supabase
    .from('player_inventory')
    .select('item_name, slot_type')
    .eq('session_id', sessionId)

  const inventoryNames = (inventoryRows ?? [])
    .filter((r: { slot_type?: string }) => r.slot_type !== 'ability')
    .map((r: { item_name: string }) => r.item_name)
  const abilityNames = (inventoryRows ?? [])
    .filter((r: { slot_type?: string }) => r.slot_type === 'ability')
    .map((r: { item_name: string }) => r.item_name)

  // 1b. Items at current location (with aliases for fuzzy matching)
  type LocItem = {
    id: string; name: string; aliases: string[] | null; unlock_node_id: string | null
  }
  let locationItems: LocItem[] = []
  if (currentLocationId) {
    const { data } = await supabase
      .from('items')
      .select('id, name, aliases, unlock_node_id')
      .eq('world_id', worldId)
      .eq('location_id', currentLocationId)
    locationItems = (data ?? []) as LocItem[]
  }

  // Separate into accessible vs locked
  const accessibleLocItems: LocItem[] = []
  const lockedLocItems: LocItem[] = []
  for (const item of locationItems) {
    if (!item.unlock_node_id || unlockedNodeIds.has(item.unlock_node_id)) {
      accessibleLocItems.push(item)
    } else {
      lockedLocItems.push(item)
    }
  }

  const allAccessibleNames = [
    ...inventoryNames,
    ...abilityNames,
    ...accessibleLocItems.map(i => i.name),
  ]

  // ── 2. Fast path: substring matching ──────────────────────────────────

  // Check accessible items (name + aliases)
  for (const name of inventoryNames) {
    if (fuzzyContains(playerMessage, name)) {
      console.log(`[Node 0 · Gate] ✅ 快速匹配(背包): "${name}"`)
      return { blocked: false }
    }
  }
  for (const name of abilityNames) {
    if (fuzzyContains(playerMessage, name)) {
      console.log(`[Node 0 · Gate] ✅ 快速匹配(能力): "${name}"`)
      return { blocked: false }
    }
  }
  for (const item of accessibleLocItems) {
    const names = [item.name, ...(item.aliases ?? [])]
    if (names.some(n => fuzzyContains(playerMessage, n))) {
      console.log(`[Node 0 · Gate] ✅ 快速匹配(当前地点): "${item.name}"`)
      return { blocked: false }
    }
  }

  // Check locked items — also blocked (same as not_found)
  for (const item of lockedLocItems) {
    const names = [item.name, ...(item.aliases ?? [])]
    if (names.some(n => fuzzyContains(playerMessage, n))) {
      console.log(`[Node 0 · Gate] 🔒 快速匹配(锁定物品，拦截): "${item.name}"`)
      return {
        blocked: true,
        rejectionMessage: buildLockedRejectionMessage(item.name, currentLocationName),
      }
    }
  }

  // ── 3. Slow path: LLM fuzzy matching ─────────────────────────────────
  // Player might use abbreviations, nicknames, or vague descriptions

  const lockedNames = lockedLocItems.map(i => i.name)

  const systemPrompt = `你是物品验证器。判断玩家消息中提到的物品是否在下面的列表中。

可获取物品（玩家背包+当前位置已解锁）:
${allAccessibleNames.length > 0 ? allAccessibleNames.map(n => `- ${n}`).join('\n') : '（无）'}

当前位置锁定物品（存在但不可获取）:
${lockedNames.length > 0 ? lockedNames.map(n => `- ${n}`).join('\n') : '（无）'}

判断规则:
- 玩家提到的物品名与"可获取物品"中的任何一个匹配（包括别名、简称、描述性称呼）→ accessible
- 玩家提到的物品名与"锁定物品"中的任何一个匹配 → locked
- 玩家提到了某个物品但不在任何列表中 → not_found
- 玩家没有提到具体物品名称（如"我看看周围"、"我往前走"）→ no_item_reference
- 模糊匹配示例: "徽章"匹配"试炼银徽", "剑"匹配"破旧短剑", "药水"匹配"魔力药水"

调用 validate_action 函数。`

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `玩家说: "${playerMessage}"` },
      ],
      tools: [VALIDATE_TOOL],
      tool_choice: { type: 'function', function: { name: 'validate_action' } },
      max_completion_tokens: 200,
    })

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall) || !toolCall.function?.arguments) {
      console.warn('[Node 0 · Gate] LLM未返回工具调用，放行')
      return { blocked: false }
    }

    const result = JSON.parse(toolCall.function.arguments) as {
      references_item: boolean
      referenced_name: string
      match_result: 'accessible' | 'locked' | 'not_found' | 'no_item_reference'
      matched_item_name?: string
    }

    const matchedDisplay = result.matched_item_name ? ` → 「${result.matched_item_name}」` : ''
    console.log(`[Node 0 · Gate] LLM验证: "${result.referenced_name}" → ${result.match_result}${matchedDisplay}`)

    switch (result.match_result) {
      case 'accessible':
      case 'no_item_reference':
        return { blocked: false }

      case 'locked':
        return {
          blocked: true,
          rejectionMessage: buildLockedRejectionMessage(
            result.matched_item_name ?? result.referenced_name,
            currentLocationName
          ),
        }

      case 'not_found':
        return {
          blocked: true,
          rejectionMessage: buildRejectionMessage(
            result.referenced_name,
            currentLocationName
          ),
        }

      default:
        return { blocked: false }
    }
  } catch (error) {
    console.error('[Node 0 · Gate] 验证失败，放行:', error)
    return { blocked: false } // Fail open
  }
}

// ── Message Builders ────────────────────────────────────────────────────────

function buildRejectionMessage(itemName: string, locationName: string | null): string {
  const where = locationName ? `在${locationName}中` : '这里'
  return `你环顾四周，但${where}并没有「${itemName}」这样的东西。你翻了翻自己的背包，也没有找到。也许你记错了，又或者它在别的地方。`
}

function buildLockedRejectionMessage(itemName: string, locationName: string | null): string {
  const where = locationName ? `在${locationName}中` : '这里'
  return `你注意到${where}确实有「${itemName}」的存在，但你目前无法获取它——也许他本就是无法获取的、也许你需要先完成某些事情，才能将它收入囊中。又或者、你这辈子都无法获取到它了......`
}
