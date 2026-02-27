/**
 * NODE 3C: Scenario Event Generator
 *
 * Analyzes the current scenario context and player action to generate
 * a structured dice challenge event using the 5-dimension custom dice system.
 *
 * Five dice types:
 *   COMBAT     (战斗) — Physical combat, violence, defense
 *   PERSUASION (游说) — Social interaction, negotiation, deception
 *   CHAOS      (混沌) — Unpredictable, risky, chaotic actions
 *   CHARM      (魅力) — Seduction, flirting, personal magnetism, attracting others
 *   WIT        (才智) — Puzzles, strategy, knowledge, clever planning
 *
 * DC range: 4 (easy) → 10 (very hard) for d12
 * Attribute starts at 0, each success adds +1 to that dimension.
 *
 * Runs in parallel with Node 3A and 3B.
 * Fallback: NULL_SCENARIO_EVENT (no check, auto-success path).
 */

import OpenAI from 'openai'
import type { IntentClassification } from '../types/intent'
import type { ScenarioEvent, CustomDiceType } from '../types/custom-dice'
import { NULL_SCENARIO_EVENT, CUSTOM_DICE_LABELS } from '../types/custom-dice'
import { MODEL_FAST } from '@/lib/config'

const SCENARIO_EVENT_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'generate_scenario_event',
    description: 'Analyze the player action and generate a dice challenge event if warranted.',
    parameters: {
      type: 'object',
      properties: {
        triggered: {
          type: 'boolean',
          description: 'Whether a dice check is needed for this action. False for simple/narrative actions.',
        },
        diceType: {
          type: 'string',
          enum: ['COMBAT', 'PERSUASION', 'CHAOS', 'CHARM', 'WIT'],
          description: 'Which of the 5 attribute dice to use for this check.',
        },
        dc: {
          type: 'integer',
          minimum: 4,
          maximum: 11,
          description: 'Difficulty Class: 4=easy, 6=moderate, 8=hard, 10=very hard, 11=extreme',
        },
        eventTitle: {
          type: 'string',
          description: 'Short title for this challenge (e.g. "Combat Confrontation", "Desperate Bargain")',
        },
        eventDescription: {
          type: 'string',
          description: 'One sentence describing the specific challenge the player faces right now.',
        },
        successNarrative: {
          type: 'string',
          description: 'Brief guidance for DM: what should happen if the dice check succeeds.',
        },
        failureNarrative: {
          type: 'string',
          description: 'Brief guidance for DM: what should happen if the dice check fails.',
        },
      },
      required: ['triggered', 'diceType', 'dc', 'eventTitle', 'eventDescription', 'successNarrative', 'failureNarrative'],
    },
  },
}

const SYSTEM_PROMPT = `You are a scenario event generator for a TTRPG game.
Analyze the player's action and current scenario to determine if a dice challenge is needed.

THE 5 DICE TYPES (choose the most fitting):
- COMBAT (战斗): Physical fighting, melee/ranged weapon attacks, defending, acrobatic escapes
- PERSUASION (游说): Talking someone into something, deception, negotiation, intimidation
- CHAOS (混沌): Wild gambles, unpredictable stunts, acting on impulse, immoral/chaotic behavior
- CHARM (魅力): Seduction, flirting, intimate/romantic interactions, attracting others, personal magnetism
- WIT (才智): Casting spells/magic, solving puzzles, clever strategies, deductions, researching, outsmarting

IMPORTANT — Intent to dice type guidelines:
- Intent=COMBAT (physical weapon attack) → COMBAT dice
- Intent=SPELL_CAST (casting any spell or ability to attack/buff/heal) → WIT dice, unless the spell is chaotic/wild (CHAOS)
- Intent=SOCIAL with persuasion/deception/negotiation → PERSUASION
- Seduction, flirting, romantic → CHARM
- Reckless, immoral, impulsive acts → CHAOS
- Active investigation/searching (examining, searching for clues, looking for secrets) → WIT

WHEN TO TRIGGER (triggered=true):
- Any combat or physical confrontation
- Casting spells or using magical abilities (always triggered!)
- Attempts to persuade, deceive, or influence an NPC
- Wild/risky actions with uncertain outcomes
- Strategy/intelligence challenges
- Activating magical altars, ritual objects, or key story mechanisms (these are NOT simple objects!)
- When a hostile NPC appears/reveals hostility toward the player
- Active investigation/search actions → WIT check! Examples: "仔细观察", "寻找线索", "搜索房间", "检查周围", "寻找破局之法", "探索密室". The key is the player is ACTIVELY trying to discover or analyze something.

WHEN NOT TO TRIGGER (triggered=false):
- Moving to or entering a location ("进入竞技场", "走进密室", "前往广场") — this is travel, NOT investigation
- Basic self-care (resting, eating)
- Meta/out-of-character questions
- Picking up, taking, or grabbing items from the environment
- EQUIPPING, WEARING, or PUTTING ON items — "装备X", "穿上X", "穿戴X", "戴上X", "握住X" → ALWAYS triggered=false, even if the item is magical! Equipping is a routine inventory action, NOT a skill challenge.
- UNEQUIPPING or REMOVING items — "卸下X", "脱下X" → ALWAYS triggered=false
- Simple interactions with NON-MAGICAL, mundane objects (opening doors, lighting candles, reading signs)
- Purely asking the DM a question about lore/world without taking any action
- CASUAL CONVERSATION with NPCs: greeting, chatting, asking about lore/history, small talk, expressing thanks/emotions — these are NOT persuasion!

SOCIAL INTENT DISTINCTION — casual talk vs persuasion:
- "和NPC聊天" / "问NPC这里的历史" / "打招呼" / "感谢NPC" = CASUAL TALK → triggered=false
- "说服NPC给我打折" / "欺骗守卫让我通过" / "威胁NPC交出物品" = PERSUASION ATTEMPT → triggered=true, PERSUASION
The difference: casual talk exchanges information, persuasion tries to CHANGE the NPC's decision or behavior.

EXPLORE INTENT DISTINCTION — movement vs investigation:
- "进入竞技场" / "走向密室" / "去找裁判" = MOVEMENT → triggered=false
- "仔细观察竞技场" / "搜索密室" / "检查墙壁上的裂缝" = INVESTIGATION → triggered=true, WIT
The difference: movement changes location, investigation tries to DISCOVER something at the current location.

DC GUIDELINES (d12 system, player attribute starts at 0):
- DC 4: Very easy (simple obstacle, cooperative NPC)
- DC 5-6: Easy (routine challenge)
- DC 7-8: Moderate (genuine challenge requiring skill)
- DC 9-10: Hard (experienced opponent, complex puzzle)
- DC 11: Extreme (almost impossible without attribute growth)

DC FOR EXPLORATION/INVESTIGATION (lower than normal!):
Exploration WIT checks should be EASY — the point is to reward curiosity, not punish it.
- General searching (e.g.: "观察四周", "搜索房间"): DC 3-4
- Looking for something specific or hidden (e.g.: "寻找暗门", "检查可疑裂缝"): DC 5-6
- Uncovering well-hidden secrets or traps: DC 7 at most
Do NOT use DC 8+ for exploration. Reserve high DCs for combat, social manipulation, and dangerous actions.

Always call the generate_scenario_event function.`

export type ScenarioEventGeneratorInput = {
  playerMessage: string
  intent: IntentClassification
  recentHistory: Array<{ author: string; content: string }>
  worldSetting?: string   // Brief world context
  /** Player's current custom attribute levels — used to calibrate DC difficulty */
  playerAttributeValues?: { combat: number; persuasion: number; chaos: number; charm: number; wit: number }
  /** Whether the player is currently in active combat (from DB in_combat flag) */
  inCombat?: boolean
  openai: OpenAI
}

/** Maps lowercase CustomAttributes keys to uppercase CustomDiceType enum values */
const ATTR_TO_DICE: Record<string, string> = {
  combat: 'COMBAT', persuasion: 'PERSUASION', chaos: 'CHAOS', charm: 'CHARM', wit: 'WIT',
}

/**
 * Generates a scenario event for this turn's dice check.
 * Falls back to NULL_SCENARIO_EVENT on any error.
 */
export async function generateScenarioEvent(
  input: ScenarioEventGeneratorInput
): Promise<ScenarioEvent> {
  const { playerMessage, intent, recentHistory, worldSetting, playerAttributeValues, inCombat, openai } = input

  const recentHistoryText = recentHistory
    .slice(-4)
    .map(m => `${m.author === 'player' ? 'Player' : 'DM'}: ${m.content.substring(0, 150)}`)
    .join('\n')

  const diceTypeDescriptions = Object.entries(CUSTOM_DICE_LABELS)
    .map(([key, label]) => `${key} (${label})`)
    .join(', ')

  // Build adaptive DC hint based on current player attribute levels
  let dcAdaptiveHint = ''
  if (playerAttributeValues) {
    const attrLines = Object.entries(playerAttributeValues)
      .map(([key, val]) => {
        const diceKey = ATTR_TO_DICE[key] ?? key.toUpperCase()
        // DC max scales: base 11 + floor(attr/5)*2, capped at 50
        const dcMax = Math.min(50, 11 + Math.floor(val / 5) * 2)
        return `  - ${diceKey}: attribute=${val} → effective DC range 4–${dcMax}`
      })
      .join('\n')
    dcAdaptiveHint = `\n\nPlayer's current attribute levels (each point adds +1 to d12 roll):\n${attrLines}\nCalibrate DC so the player has ~50-60% success rate at moderate difficulty for their level.`
  }

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `World context: ${worldSetting?.substring(0, 200) ?? 'Fantasy TTRPG world'}
${inCombat ? '\n⚠️ ACTIVE COMBAT: The player is currently in turn-based combat with a hostile NPC. You MUST set triggered=true and use COMBAT (for physical attacks) or WIT (for spells). NEVER set triggered=false during active combat.\n' : ''}
Recent conversation:
${recentHistoryText || '(start of session)'}

Player's action: "${playerMessage}"
Classified intent: ${intent.intent} (${diceTypeDescriptions})${dcAdaptiveHint}

Generate an appropriate scenario event or determine no check is needed.`,
        },
      ],
      tools: [SCENARIO_EVENT_TOOL],
      tool_choice: { type: 'function', function: { name: 'generate_scenario_event' } },
      max_completion_tokens: 300,
    })

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall)) {
      console.warn('[Node 3C · ScenarioEvent] 未返回工具调用，使用空事件')
      return { ...NULL_SCENARIO_EVENT }
    }

    const args = JSON.parse(toolCall.function.arguments) as {
      triggered: boolean
      diceType: CustomDiceType
      dc: number
      eventTitle: string
      eventDescription: string
      successNarrative: string
      failureNarrative: string
    }

    if (!args.triggered) {
      console.log(`[Node 3C · ScenarioEvent] 未触发事件，intent=${intent.intent}`)
      return { ...NULL_SCENARIO_EVENT }
    }

    // Compute adaptive DC ceiling for the chosen diceType
    const relevantAttrKey = args.diceType.toLowerCase()
    const relevantAttr = playerAttributeValues
      ? ((playerAttributeValues as Record<string, number>)[relevantAttrKey] ?? 0)
      : 0
    const adaptiveDcMax = Math.min(50, 11 + Math.floor(relevantAttr / 5) * 2)

    const event: ScenarioEvent = {
      triggered: true,
      diceType: args.diceType,
      dc: Math.max(4, Math.min(adaptiveDcMax, args.dc)),  // Clamp to [4, adaptiveDcMax]
      eventTitle: args.eventTitle,
      eventDescription: args.eventDescription,
      successNarrative: args.successNarrative,
      failureNarrative: args.failureNarrative,
    }

    console.log(`[Node 3C · ScenarioEvent] Event: "${event.eventTitle}" | dice=${event.diceType} DC=${event.dc}`)
    return event

  } catch (error) {
    console.error('[Node 3C · ScenarioEvent] 出错，跳过骰子检定:', error)
    return { ...NULL_SCENARIO_EVENT }
  }
}
