/**
 * NODE 18: NPC Memory Updater
 *
 * Post-turn background task that analyzes the DM response and player action
 * to determine what each in-scene NPC should remember from this turn.
 *
 * One MODEL_FAST call processes all NPCs, then UPSERTs memory rows.
 * Runs fire-and-forget alongside Nodes 11-17.
 *
 * Fallback: silently fails (memory updates are optional enhancement).
 */

import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import type { NPC } from './2-data-retrieval'
import type { NPCMemory, NPCMemoryUpdate } from '../types/npc-agent'
import { MODEL_FAST } from '@/lib/config'

// ── Types ─────────────────────────────────────────────────────────────────

export type NPCMemoryUpdaterInput = {
  sessionId: string
  npcs: NPC[] | null
  npcMemories: NPCMemory[]
  playerMessage: string
  dmResponse: string
  openai: OpenAI
  supabase: SupabaseClient
}

// ── Tool Definition ───────────────────────────────────────────────────────

const MEMORY_UPDATE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'update_npc_memories',
    description: 'Determine memory updates for each NPC based on what happened this turn.',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              npcName: {
                type: 'string',
                description: 'NPC name (must match input exactly).',
              },
              newMemory: {
                type: ['string', 'null'],
                description: 'A concise memory entry to add (e.g. "玩家击败了守卫"), or null if nothing memorable happened for this NPC.',
              },
              attitudeShift: {
                type: ['string', 'null'],
                enum: ['friendly', 'hostile', 'neutral', 'afraid', 'respectful', null],
                description: 'New attitude, or null if unchanged.',
              },
              statusChange: {
                type: ['string', 'null'],
                enum: ['alive', 'dead', 'fled', 'allied', null],
                description: 'New status, or null if unchanged.',
              },
            },
            required: ['npcName', 'newMemory', 'attitudeShift', 'statusChange'],
          },
        },
      },
      required: ['updates'],
    },
  },
}

// ── System Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个TTRPG的NPC记忆管理器。根据这一轮发生的事件，决定每个NPC应该记住什么。

规则：
- 只记录对NPC有意义的事件（与他们相关、他们目睹的、影响他们的）
- 记忆条目简洁，一句话描述，使用第三人称（"玩家做了X"，而非"我看到了X"）
- 如果这轮对某个NPC没有值得记忆的事件，newMemory设为null
- 态度变化需要有明确原因（玩家帮助了NPC → friendly，玩家攻击了NPC → hostile）
- 状态变化只在NPC死亡、逃跑、结盟时更新
- 大多数轮次，大多数NPC不需要更新

调用 update_npc_memories 函数。`

// ── Main Function ─────────────────────────────────────────────────────────

/**
 * Analyzes the turn and updates NPC memory rows in the database.
 * Silently fails on any error.
 */
export async function updateNPCMemories(
  input: NPCMemoryUpdaterInput
): Promise<void> {
  const { sessionId, npcs, npcMemories, playerMessage, dmResponse, openai, supabase } = input

  if (!npcs || npcs.length === 0) return

  try {
    // Build NPC context for LLM
    const memoryMap = new Map<string, NPCMemory>()
    for (const mem of npcMemories) {
      memoryMap.set(mem.npcName, mem)
    }

    const npcSummaries = npcs.map(npc => {
      const mem = memoryMap.get(npc.name)
      let summary = `${npc.name}: ${npc.description?.substring(0, 80) ?? ''}`
      if (mem) {
        summary += ` | 当前态度: ${mem.attitude} | 状态: ${mem.status}`
        if (mem.memories.length > 0) {
          summary += ` | 已有记忆: ${mem.memories.slice(-3).join('; ')}`
        }
      }
      return summary
    }).join('\n')

    const userContent = `在场NPC:\n${npcSummaries}

玩家行动: "${playerMessage}"

DM叙述(摘要): ${dmResponse.substring(0, 600)}`

    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      tools: [MEMORY_UPDATE_TOOL],
      tool_choice: { type: 'function', function: { name: 'update_npc_memories' } },
      max_completion_tokens: 500,
    })

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall) || !toolCall.function?.arguments) {
      console.warn('[Node 18 · NPCMemUpdate] 未返回工具调用，跳过')
      return
    }

    const result = JSON.parse(toolCall.function.arguments) as {
      updates: Array<{
        npcName: string
        newMemory: string | null
        attitudeShift: string | null
        statusChange: string | null
      }>
    }

    // Map NPC names to IDs
    const npcIdMap = new Map<string, string>()
    for (const npc of npcs) {
      const npcWithId = npc as NPC & { id?: string }
      if (npcWithId.id) {
        npcIdMap.set(npc.name, npcWithId.id)
      }
    }

    // Process each update
    let updatedCount = 0
    for (const update of result.updates) {
      const npcId = npcIdMap.get(update.npcName)
      if (!npcId) continue

      // Skip if nothing to update
      if (!update.newMemory && !update.attitudeShift && !update.statusChange) continue

      const existingMemory = memoryMap.get(update.npcName)

      if (existingMemory) {
        // UPDATE existing row
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

        if (update.attitudeShift) updates.attitude = update.attitudeShift
        if (update.statusChange) updates.status = update.statusChange

        // Append new memory via array_append
        if (update.newMemory) {
          const newMemories = [...existingMemory.memories, update.newMemory]
          // Keep at most 20 memories (trim oldest)
          updates.memories = newMemories.slice(-20)
        }

        const { error } = await supabase
          .from('session_npc_memory')
          .update(updates)
          .eq('session_id', sessionId)
          .eq('npc_id', npcId)

        if (error) {
          console.error(`[Node 18 · NPCMemUpdate] 更新 ${update.npcName} 失败:`, error.message)
        } else {
          updatedCount++
        }
      } else {
        // INSERT new row
        const { error } = await supabase
          .from('session_npc_memory')
          .insert({
            session_id: sessionId,
            npc_id: npcId,
            memories: update.newMemory ? [update.newMemory] : [],
            attitude: update.attitudeShift ?? 'neutral',
            status: update.statusChange ?? 'alive',
            last_seen_turn: 0,
          })

        if (error) {
          console.error(`[Node 18 · NPCMemUpdate] 插入 ${update.npcName} 失败:`, error.message)
        } else {
          updatedCount++
        }
      }
    }

    // Log detailed update info
    for (const update of result.updates) {
      if (update.newMemory || update.attitudeShift || update.statusChange) {
        console.log(
          `[Node 18 · NPCMemUpdate] ${update.npcName}: ` +
          `${update.newMemory ? `新记忆="${update.newMemory}"` : '无新记忆'}` +
          `${update.attitudeShift ? `, 态度→${update.attitudeShift}` : ''}` +
          `${update.statusChange ? `, 状态→${update.statusChange}` : ''}`
        )
      }
    }
    console.log(`[Node 18 · NPCMemUpdate] 共更新 ${updatedCount} 个NPC的记忆`)

  } catch (error) {
    console.error('[Node 18 · NPCMemUpdate] 出错（非致命）:', error)
  }
}
