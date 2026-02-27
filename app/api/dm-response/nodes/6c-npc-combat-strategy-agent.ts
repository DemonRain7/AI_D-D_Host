/**
 * NODE 6C: NPC Combat Strategy Agent
 *
 * Uses LLM function calling to select the NPC's combat action for the
 * current turn. Considers NPC HP/MP/abilities, player stats, and recent
 * context to make tactical decisions.
 *
 * Fallback: on LLM failure, falls back to a pure function that picks
 * the highest damage ability the NPC can afford (original Node 6 logic).
 */

import OpenAI from 'openai'
import { MODEL_FAST } from '@/lib/config'
import type { NpcAbilityForCombat } from './6-outcome-synthesizer'

export type NpcCombatStrategyInput = {
  npcName: string
  npcHp: number
  npcMaxHp: number
  npcMp: number
  npcMaxMp: number
  npcAttack: number
  npcDefense: number
  abilities: NpcAbilityForCombat[]
  playerHp: number
  playerMaxHp: number
  playerAttack: number
  playerDefense: number
  recentContext: string
  openai: OpenAI
}

export type NpcCombatStrategyOutput = {
  chosenAbility: NpcAbilityForCombat | null
  reasoning: string
}

const COMBAT_STRATEGY_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'select_combat_action',
    description: 'Select the NPC combat action for this turn',
    parameters: {
      type: 'object',
      properties: {
        action_type: {
          type: 'string',
          enum: ['ability', 'basic_attack'],
          description: 'Use a specific ability or basic attack',
        },
        ability_name: {
          type: 'string',
          description: 'Exact name of the ability to use (required if action_type is "ability")',
        },
        reasoning: {
          type: 'string',
          description: 'Brief tactical reasoning for the choice (1-2 sentences)',
        },
      },
      required: ['action_type', 'reasoning'],
    },
  },
}

/**
 * Uses LLM to select the NPC's combat action.
 * Falls back to pure function on any error.
 */
export async function selectNpcCombatStrategy(
  input: NpcCombatStrategyInput
): Promise<NpcCombatStrategyOutput> {
  const {
    npcName, npcHp, npcMaxHp, npcMp, npcMaxMp,
    npcAttack, npcDefense, abilities,
    playerHp, playerMaxHp, playerAttack, playerDefense,
    recentContext, openai,
  } = input

  // No abilities → basic attack
  if (abilities.length === 0) {
    return { chosenAbility: null, reasoning: '无可用技能，使用普通攻击' }
  }

  // Filter to affordable abilities (MP-wise)
  const affordable = abilities.filter(a => a.mp_cost <= npcMp)
  if (affordable.length === 0) {
    return { chosenAbility: null, reasoning: 'MP不足，使用普通攻击' }
  }

  const abilityList = affordable.map(a => {
    const parts: string[] = [`「${a.name}」`]
    if (a.damage > 0) parts.push(`伤害${a.damage}`)
    if (a.hp_restore > 0) parts.push(`治疗${a.hp_restore}HP`)
    if (a.hp_restore < 0) parts.push(`吸取${Math.abs(a.hp_restore)}HP（无视防御）`)
    if (a.mp_cost > 0) parts.push(`消耗${a.mp_cost}MP`)
    return parts.join(' ')
  }).join('\n')

  const systemPrompt = `你是TTRPG战斗中NPC「${npcName}」的战术AI。根据当前战斗状态选择最优行动。
考虑因素：HP剩余比例、MP剩余、技能伤害/治疗效率、玩家威胁程度。
做出合理的战术决策——不要总是选最高伤害技能。`

  const userPrompt = `当前战斗状态：
NPC「${npcName}」: HP ${npcHp}/${npcMaxHp}, MP ${npcMp}/${npcMaxMp}, ATK ${npcAttack}, DEF ${npcDefense}
玩家: HP ${playerHp}/${playerMaxHp}, ATK ${playerAttack}, DEF ${playerDefense}

可用行动：
普通攻击: 使用基础ATK${npcAttack}
${abilityList}

近期上下文：
${recentContext || '(无)'}

选择NPC本回合的行动。`

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      tools: [COMBAT_STRATEGY_TOOL],
      tool_choice: { type: 'function', function: { name: 'select_combat_action' } },
      max_completion_tokens: 200,
    })

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall)) {
      console.warn('[Node 6C · NPCStrategy] 未返回工具调用，回退到纯函数')
      return fallbackSelection(affordable, npcHp, npcMaxHp)
    }

    const args = JSON.parse(toolCall.function.arguments) as {
      action_type: 'ability' | 'basic_attack'
      ability_name?: string
      reasoning: string
    }

    if (args.action_type === 'basic_attack') {
      console.log(`[Node 6C · NPCStrategy] NPC选择普通攻击: ${args.reasoning}`)
      return { chosenAbility: null, reasoning: args.reasoning }
    }

    // Find the named ability (fuzzy match — LLM may not return exact name)
    const chosen = affordable.find(a =>
      a.name === args.ability_name ||
      a.name.includes(args.ability_name ?? '') ||
      (args.ability_name ?? '').includes(a.name)
    )

    if (!chosen) {
      console.warn(`[Node 6C · NPCStrategy] LLM选择了未知技能「${args.ability_name}」，回退到纯函数`)
      return fallbackSelection(affordable, npcHp, npcMaxHp)
    }

    console.log(`[Node 6C · NPCStrategy] NPC选择「${chosen.name}」: ${args.reasoning}`)
    return { chosenAbility: chosen, reasoning: args.reasoning }

  } catch (error) {
    console.error('[Node 6C · NPCStrategy] LLM调用失败，回退到纯函数:', error)
    return fallbackSelection(affordable, npcHp, npcMaxHp)
  }
}

/**
 * Fallback: pure function selection (same as original Node 6 logic).
 * Picks highest damage offensive ability, or healing if HP < 30%.
 */
function fallbackSelection(
  affordable: NpcAbilityForCombat[],
  npcHp: number,
  npcMaxHp: number
): NpcCombatStrategyOutput {
  const offensive = affordable
    .filter(a => a.damage > 0)
    .sort((a, b) => b.damage - a.damage)
  const drain = affordable
    .filter(a => a.hp_restore < 0 && a.damage === 0)
    .sort((a, b) => a.hp_restore - b.hp_restore) // most negative first (highest drain)
  const healing = affordable
    .filter(a => a.hp_restore > 0)
    .sort((a, b) => b.hp_restore - a.hp_restore)

  // If HP < 30% and healing is available, heal
  if (npcMaxHp > 0 && npcHp / npcMaxHp < 0.3 && healing.length > 0) {
    return { chosenAbility: healing[0], reasoning: 'HP过低，自动回退选择治疗' }
  }

  // Pick highest damage offensive ability
  if (offensive.length > 0) {
    return { chosenAbility: offensive[0], reasoning: '回退：选择最高伤害技能' }
  }

  // Pick drain ability if no direct damage abilities
  if (drain.length > 0) {
    return { chosenAbility: drain[0], reasoning: '回退：选择HP吸取技能' }
  }

  return { chosenAbility: null, reasoning: '回退：无可用攻击技能，普通攻击' }
}
