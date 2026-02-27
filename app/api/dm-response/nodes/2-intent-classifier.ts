/**
 * NODE 2: Intent Classifier
 *
 * Uses GPT-4o-mini with function calling to classify the player's action
 * into one of 7 intent types. This fast, cheap classification unlocks
 * intent-aware RAG Top-K and the dice resolution path.
 *
 * Fallback: returns NARRATIVE intent on any error.
 */

import OpenAI from 'openai'
import type { IntentClassification, IntentType } from '../types/intent'
import { FALLBACK_INTENT } from '../types/intent'
import { MODEL_FAST } from '@/lib/config'

const INTENT_CLASSIFIER_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'classify_intent',
    description: 'Classify a TTRPG player action into an intent category',
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['COMBAT', 'SPELL_CAST', 'ITEM_USE', 'EXPLORE', 'SOCIAL', 'NARRATIVE', 'META'],
          description: 'The primary intent of the player action',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence score from 0 to 1',
        },
        mentionedEntities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of items, NPCs, spells, or locations mentioned in the action',
        },
        targetEntity: {
          type: 'string',
          description: 'The primary target of the action (NPC name, item name, etc.)',
        },
        isBatchAction: {
          type: 'boolean',
          description: 'True when the player wants to act on ALL or MULTIPLE unspecified targets at once (e.g. "pick up everything", "拾取所有物品", "全部拿走", "equip all"). False when targeting a single specific item/entity.',
        },
      },
      required: ['intent', 'confidence', 'mentionedEntities'],
    },
  },
}

const SYSTEM_PROMPT = `You are an intent classifier for a TTRPG (tabletop role-playing game).
Classify the player's action into exactly ONE intent type:

- COMBAT: physical attacks with weapons or bare hands. Examples: "攻击幻影刺客" = COMBAT, "用雷电之戒攻击幻影刺客" = COMBAT, "用剑砍史莱姆" = COMBAT, "踢他" = COMBAT, "冲上去打" = COMBAT.
- SPELL_CAST: using a spell or ability (from the player's skill/ability list) to attack or cast. **This includes spell attacks targeting enemies!** Examples: "使用火球术攻击幻影刺客" = SPELL_CAST, "对幻影刺客释放冰冻术" = SPELL_CAST, "施放治愈之光" = SPELL_CAST, "用暗影步攻击" = SPELL_CAST.
- ITEM_USE: using/consuming/activating a non-combat item (potion, scroll, key, tool) WITHOUT attacking. Picking up items, equipping items, drinking potions. Examples: "使用治愈水晶" = ITEM_USE, "装备雷电之戒" = ITEM_USE, "喝下治愈药水" = ITEM_USE, "拾取破旧短剑" = ITEM_USE.
- EXPLORE: looking around, searching, moving to a location, examining objects, listening, touching/interacting with environmental objects (altars, levers, doors, statues)
- SOCIAL: talking to NPCs, persuading, deceiving, intimidating, negotiating, asking NPCs questions
- NARRATIVE: asking questions about the world/lore, roleplaying dialogue without targeting an NPC
- META: out-of-character questions about game rules, asking for help with mechanics, checking inventory/stats/abilities

## Critical Classification Rules:
1. **SPELL_CAST vs COMBAT**: If the player uses a spell/ability/skill name (火球术, 冰冻术, 暗影步, etc.) to attack → SPELL_CAST. If the player uses a physical weapon/item (剑, 戒指, 斧头) or bare hands to attack → COMBAT.
2. **ITEM_USE vs COMBAT**: If the player uses an item (weapon/equipment) TO ATTACK a target → COMBAT (not ITEM_USE). If the player only uses/consumes/equips an item without attacking → ITEM_USE.
3. Set targetEntity to the PRIMARY TARGET of the action:
   - For attacks (COMBAT/SPELL_CAST): targetEntity = the NPC being attacked (e.g. "幻影刺客")
   - For ITEM_USE: targetEntity = the item being used (e.g. "治愈水晶")
4. Extract ALL entity names (items, NPCs, spells, locations) into mentionedEntities.

Set isBatchAction=true when the player wants to act on ALL or MULTIPLE unspecified targets at once.
Examples of batch actions: "拾取所有物品", "全部拿走", "把东西都收了", "装备所有", "pick up everything", "equip all".
Examples of NON-batch actions: "拾取破旧短剑" (specific item), "使用治愈水晶" (specific item).

Always call the classify_intent function.`

export type IntentClassifierInput = {
  playerMessage: string
  recentHistory: Array<{ author: string; content: string }>
  openai: OpenAI
}

/**
 * Classifies player intent using LLM function calling.
 * Falls back to NARRATIVE on any error.
 */
export async function classifyIntent(
  input: IntentClassifierInput
): Promise<IntentClassification> {
  const { playerMessage, recentHistory, openai } = input

  // Internal system markers — bypass LLM
  if (playerMessage === '__GAME_START__') {
    return { ...FALLBACK_INTENT, rawMessage: playerMessage }
  }
  if (playerMessage.startsWith('__META:')) {
    return {
      intent: 'META' as IntentType,
      confidence: 1,
      mentionedEntities: [],
      rawMessage: playerMessage,
    }
  }

  const recentHistoryText = recentHistory
    .slice(-3)
    .map(m => `${m.author === 'player' ? 'Player' : 'DM'}: ${m.content.substring(0, 200)}`)
    .join('\n')

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Recent context:\n${recentHistoryText || '(no history)'}\n\nPlayer action: "${playerMessage}"\n\nClassify this action.`,
        },
      ],
      tools: [INTENT_CLASSIFIER_TOOL],
      tool_choice: { type: 'function', function: { name: 'classify_intent' } },
      max_completion_tokens: 200,
    })

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall)) {
      console.warn('[Node 2 · Intent] 未返回工具调用，使用回退值')
      return { ...FALLBACK_INTENT, rawMessage: playerMessage }
    }

    const args = JSON.parse(toolCall.function.arguments) as {
      intent: IntentType
      confidence: number
      mentionedEntities: string[]
      targetEntity?: string
      isBatchAction?: boolean
    }

    const result: IntentClassification = {
      intent: args.intent,
      confidence: args.confidence,
      mentionedEntities: args.mentionedEntities ?? [],
      targetEntity: args.targetEntity,
      isBatchAction: args.isBatchAction ?? false,
      rawMessage: playerMessage,
    }

    console.log(`[Node 2 · Intent] intent=${result.intent} confidence=${result.confidence.toFixed(2)} entities=[${result.mentionedEntities.join(', ')}]${result.isBatchAction ? ' BATCH=true' : ''}`)
    return result

  } catch (error) {
    console.error('[Node 2 · Intent] 出错，使用回退值:', error)
    return { ...FALLBACK_INTENT, rawMessage: playerMessage }
  }
}
