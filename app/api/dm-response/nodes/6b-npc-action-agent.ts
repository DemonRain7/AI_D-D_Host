/**
 * NODE 6B: NPC Action Agent
 *
 * Independent NPC decision-making engine. For each in-scene NPC, determines
 * their action and optional dialogue based on personality, motivations,
 * memories, and the current game state.
 *
 * One MODEL_FAST call processes ALL in-scene NPCs simultaneously via
 * structured tool calling.
 *
 * Position: After Node 6 (outcome synthesizer), before Node 7 (context assembly).
 * Fallback: empty array (NPC actions are enhancement, not critical path).
 */

import OpenAI from 'openai'
import type { NPC } from './2-data-retrieval'
import type { NPCMemory, NPCAction } from '../types/npc-agent'
import type { OutcomeSynthesis } from '../types/game-mechanics'
import type { StoryState } from './3e-story-state-loader'
import { MODEL_FAST } from '@/lib/config'

// ── Types ─────────────────────────────────────────────────────────────────

export type NPCActionAgentInput = {
  npcs: NPC[] | null
  npcMemories: NPCMemory[]
  playerMessage: string
  outcomeSynthesis: OutcomeSynthesis
  storyState?: StoryState
  openai: OpenAI
}

// ── Tool Definition ───────────────────────────────────────────────────────

const NPC_ACTION_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'determine_npc_actions',
    description: 'Determine actions and optional dialogue for each NPC present in the scene.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              npcName: {
                type: 'string',
                description: 'Name of the NPC (must match input exactly).',
              },
              action: {
                type: 'string',
                description: 'What the NPC does this turn. 1-2 sentences, concrete and specific.',
              },
              dialogue: {
                type: ['string', 'null'],
                description: 'What the NPC says, or null if they stay silent. 1-2 sentences max, matching their personality.',
              },
              attitudeShift: {
                type: ['string', 'null'],
                enum: ['friendly', 'hostile', 'neutral', 'afraid', 'respectful', null],
                description: 'New attitude toward the player, or null if unchanged.',
              },
            },
            required: ['npcName', 'action', 'dialogue', 'attitudeShift'],
          },
        },
      },
      required: ['actions'],
    },
  },
}

// ── System Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个TTRPG的NPC行为模拟器。对于每个在场的NPC，根据他们的性格、动机、对玩家的记忆和态度，决定他们在这一轮中的反应和行动。

规则：
- 每个NPC独立思考，根据自己的性格和目标行动
- 行动描述1-2句话，简洁具体
- 对话最多1-2句，符合NPC性格
- NPC可以主动推进自己的目标，不一定只是对玩家行动的反应
- 如果NPC与本轮事件无关，给出一个简单的背景行动
- 态度变化只在有明确理由时才改变，大多数情况下保持null

必须为每个在场NPC生成一个行动。调用 determine_npc_actions 函数。`

// ── Main Function ─────────────────────────────────────────────────────────

/**
 * Generates independent actions for all in-scene NPCs.
 * Returns NPCAction[] that will be injected into the DM context.
 */
export async function generateNPCActions(
  input: NPCActionAgentInput
): Promise<NPCAction[]> {
  const { npcs, npcMemories, playerMessage, outcomeSynthesis, storyState, openai } = input

  if (!npcs || npcs.length === 0) {
    console.log('[Node 6B · NPCAction] 场景中无NPC，跳过')
    return []
  }

  try {
    // Build NPC profiles with memory context
    const memoryMap = new Map<string, NPCMemory>()
    for (const mem of npcMemories) {
      memoryMap.set(mem.npcName, mem)
    }

    const npcProfiles = npcs.map(npc => {
      const mem = memoryMap.get(npc.name)
      let profile = `【${npc.name}】`
      if (npc.description) profile += `\n  描述: ${npc.description}`
      if (npc.personality) profile += `\n  性格: ${npc.personality}`
      if (npc.motivations) profile += `\n  目标: ${npc.motivations}`
      if (mem) {
        profile += `\n  态度: ${mem.attitude}`
        profile += `\n  状态: ${mem.status}`
        if (mem.memories.length > 0) {
          profile += `\n  记忆: ${mem.memories.slice(-5).join(' | ')}`
        }
      } else {
        profile += `\n  态度: neutral (首次相遇)`
      }
      return profile
    }).join('\n\n')

    // Build story context snippet
    let storySnippet = ''
    if (storyState?.activeNodes?.length) {
      storySnippet = '\n当前故事阶段: ' + storyState.activeNodes.map(n => n.name).join(', ')
    }

    const userContent = `在场NPC:\n${npcProfiles}
${storySnippet}
玩家行动: "${playerMessage}"
行动结果: ${outcomeSynthesis.outcome} — ${outcomeSynthesis.narrativeHint.substring(0, 150)}`

    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      tools: [NPC_ACTION_TOOL],
      tool_choice: { type: 'function', function: { name: 'determine_npc_actions' } },
      max_completion_tokens: 800,
    })

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall) || !toolCall.function?.arguments) {
      console.warn('[Node 6B · NPCAction] 未返回工具调用，跳过')
      return []
    }

    const result = JSON.parse(toolCall.function.arguments) as {
      actions: Array<{
        npcName: string
        action: string
        dialogue: string | null
        attitudeShift: string | null
      }>
    }

    // Map NPC names back to IDs (best-effort match)
    const npcIdMap = new Map<string, string>()
    for (const npc of npcs) {
      const npcWithId = npc as NPC & { id?: string }
      if (npcWithId.id) {
        npcIdMap.set(npc.name, npcWithId.id)
      }
    }

    const actions: NPCAction[] = result.actions.map(a => ({
      npcId: npcIdMap.get(a.npcName) ?? '',
      npcName: a.npcName,
      action: a.action,
      dialogue: a.dialogue || null,
      attitudeShift: a.attitudeShift || null,
    }))

    console.log(`[Node 6B · NPCAction] 为 ${actions.length} 个NPC生成了行动`)
    return actions

  } catch (error) {
    console.error('[Node 6B · NPCAction] 出错（非致命）:', error)
    return []
  }
}
