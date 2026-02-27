/**
 * NODE 17: Story Node Completion Checker
 *
 * Runs after narrative generation (fire-and-forget, non-blocking).
 * For each active story node that has a completion_trigger, uses a fast LLM
 * call to determine whether the player's action + DM response satisfied it.
 *
 * When a trigger is satisfied:
 *   1. Marks the node as 'completed' in session_story_state
 *   2. Finds outbound story edges from that node (excluding 'fail' paths)
 *   3. Upserts next nodes as 'active' in session_story_state
 *
 * Fallback: silently skips any individual node on error — never crashes the game.
 * The overall function always resolves without throwing.
 */

import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import type { StoryNodeSummary } from './3e-story-state-loader'
import { MODEL_FAST } from '@/lib/config'

// ── Types ──────────────────────────────────────────────────────────────────

export type StoryCompletionCheckerInput = {
  sessionId: string
  playerMessage: string
  dmResponse: string
  activeNodes: StoryNodeSummary[]
  currentLocationName?: string | null  // Player's current location name for location-aware completion checks
  supabase: SupabaseClient
  openai: OpenAI
}

export type StoryCompletionResult = {
  completedNodeIds: string[]
  activatedNodeIds: string[]
}

// ── Tool Definition ────────────────────────────────────────────────────────

const COMPLETION_CHECK_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'check_trigger_satisfied',
    description: 'Determine if the story node completion trigger has been fulfilled by this turn.',
    parameters: {
      type: 'object',
      required: ['satisfied', 'reason'],
      properties: {
        satisfied: {
          type: 'boolean',
          description:
            'True ONLY if the completion trigger is clearly and fully satisfied ' +
            'by what the player did or what the DM narrated. ' +
            'False if it was only partially approached or just mentioned in passing.',
        },
        reason: {
          type: 'string',
          description: 'One sentence explaining why the trigger is or is not satisfied.',
        },
      },
    },
  },
}

// ── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  `You are a TTRPG story progress checker.\n` +
  `Given a story node completion trigger and the events of the current turn, determine if the trigger has been satisfied.\n\n` +
  `BE STRICT:\n` +
  `- The trigger must be clearly fulfilled, not merely attempted or hinted at.\n` +
  `- Confirmation must appear in either the player's action or the DM's narration.\n` +
  `- "Player is walking toward X" does NOT satisfy "Player reaches X".\n` +
  `- "Player fights the guard" does NOT satisfy "Player defeats the guard" unless the DM narrates a victory.\n` +
  `- LOCATION RULE: If the node has a specific location and the player is NOT currently at that location, the trigger CANNOT be satisfied.\n` +
  `  For example, if the node requires entering "密室" but the player is in "竞技场沙地", return satisfied=false.\n` +
  `When in doubt, return satisfied=false.`

// ── Main Function ──────────────────────────────────────────────────────────

/**
 * Checks active story nodes for completion after each turn.
 * Marks completed nodes and activates the next ones via story_edges.
 * Always resolves — silently skips errors for individual nodes.
 */
export async function checkStoryNodeCompletion(
  input: StoryCompletionCheckerInput
): Promise<StoryCompletionResult> {
  const { sessionId, playerMessage, dmResponse, activeNodes, currentLocationName, supabase, openai } = input

  const result: StoryCompletionResult = { completedNodeIds: [], activatedNodeIds: [] }

  // Only check nodes that actually have a completion trigger defined
  const nodesToCheck = activeNodes.filter(n => n.completion_trigger)
  if (nodesToCheck.length === 0) return result

  // Build the turn context once (truncated to save tokens)
  const turnContext =
    `Player's current location: "${currentLocationName ?? '未知'}"\n` +
    `Player action: "${playerMessage.slice(0, 300)}"\n\n` +
    `DM narration (excerpt): "${dmResponse.slice(0, 700)}"`

  // Pre-fetch location names for nodes that have location_id
  const nodeLocIds = [...new Set(nodesToCheck.map(n => n.location_id).filter((id): id is string => !!id))]
  const locNameMap = new Map<string, string>()
  if (nodeLocIds.length > 0) {
    const { data: locs } = await supabase.from('locations').select('id, name').in('id', nodeLocIds)
    for (const l of (locs ?? []) as Array<{ id: string; name: string }>) {
      locNameMap.set(l.id, l.name)
    }
  }

  for (const node of nodesToCheck) {
    try {
      const nodeLocName = node.location_id ? locNameMap.get(node.location_id) : null
      const locationHint = nodeLocName ? `\nNode location: "${nodeLocName}"` : ''

      const completion = await openai.chat.completions.create({
        model: MODEL_FAST,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `Story node: "${node.name}"${locationHint}\n` +
              `Completion trigger: "${node.completion_trigger}"\n\n` +
              turnContext,
          },
        ],
        tools: [COMPLETION_CHECK_TOOL],
        tool_choice: { type: 'function', function: { name: 'check_trigger_satisfied' } },
        max_completion_tokens: 120,
      })

      const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
      if (!toolCall || !('function' in toolCall) || !toolCall.function?.arguments) {
        console.warn(`[Node 17A · StoryComplete] 节点 "${node.name}" 未返回工具调用，跳过`)
        continue
      }

      const { satisfied, reason } = JSON.parse(toolCall.function.arguments) as {
        satisfied: boolean
        reason: string
      }

      console.log(
        `[Node 17A · StoryComplete] Node "${node.name}": ` +
        `${satisfied ? '✅ 已完成' : '❌ 未完成'} — ${reason}`
      )

      if (!satisfied) continue

      // ── Mark this node as completed ───────────────────────────────────────
      const { error: completeErr } = await supabase
        .from('session_story_state')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('session_id', sessionId)
        .eq('node_id', node.id)

      if (completeErr) {
        console.error(
          `[Node 17A · StoryComplete] 标记节点 "${node.name}" 完成失败:`,
          completeErr.message
        )
        continue
      }

      result.completedNodeIds.push(node.id)
      console.log(`[Node 17A · StoryComplete] ✅ 节点 "${node.name}" (${node.id}) → 已完成`)

      // ── Find and activate next nodes via story_edges ──────────────────────
      const { data: outboundEdges, error: edgeErr } = await supabase
        .from('story_edges')
        .select('to_node_id, edge_type')
        .eq('from_node_id', node.id)
        .neq('edge_type', 'fail')  // Fail paths are reserved for death/defeat events

      if (edgeErr) {
        console.error(`[Node 17A · StoryComplete] 加载 "${node.name}" 的后续边失败:`, edgeErr.message)
        continue
      }

      if (!outboundEdges || outboundEdges.length === 0) {
        console.log(`[Node 17A · StoryComplete] 节点 "${node.name}" 无后续故事边，可能是终端节点`)
        continue
      }

      const nextNodeIds = (outboundEdges as Array<{ to_node_id: string; edge_type: string }>)
        .map(e => e.to_node_id)

      // Upsert new active entries (ignoreDuplicates prevents re-activating already-visited nodes)
      const inserts = nextNodeIds.map(nodeId => ({
        session_id: sessionId,
        node_id: nodeId,
        status: 'active' as const,
      }))

      const { error: activateErr } = await supabase
        .from('session_story_state')
        .upsert(inserts, { onConflict: 'session_id,node_id', ignoreDuplicates: true })

      if (activateErr) {
        console.error(`[Node 17A · StoryComplete] 激活后续节点失败:`, activateErr.message)
      } else {
        result.activatedNodeIds.push(...nextNodeIds)
        console.log(
          `[Node 17A · StoryComplete] 从 "${node.name}" 激活了 ${nextNodeIds.length} 个后续节点`
        )
      }

      // Auto-update player location to the COMPLETED node's location_id.
      // Rationale: completing a node confirms the player was at that location.
      // Do NOT update to next/activated nodes — they represent where the player
      // CAN go, not where they ARE.
      if (node.location_id) {
        try {
          const { data: sessionRow } = await supabase
            .from('sessions')
            .select('current_location_id')
            .eq('id', sessionId)
            .single()
          const currentLocId = (sessionRow as { current_location_id?: string | null } | null)?.current_location_id
          if (node.location_id !== currentLocId) {
            await supabase.from('sessions').update({ current_location_id: node.location_id }).eq('id', sessionId)
            console.log(`[Node 17A · StoryComplete] 📍 位置确认 → ${node.location_id} (完成节点 "${node.name}")`)
          }
        } catch (locErr) {
          console.error('[Node 17A · StoryComplete] 位置更新失败，跳过:', locErr)
        }
      }

    } catch (err) {
      // Non-fatal: story completion is optional, game continues regardless
      console.error(`[Node 17A · StoryComplete] 节点 "${node.name}" 意外错误，跳过:`, err)
    }
  }

  return result
}

// ── Death Ending Activator ─────────────────────────────────────────────────

export type DeathEndingInput = {
  sessionId: string
  worldId: string
  supabase: SupabaseClient
}

/**
 * Activates any ending_bad story nodes in the world when the player dies.
 * Used by the death detection path in workflow.ts.
 * Always resolves — silently fails on any DB error.
 */
export async function activateDeathEnding(input: DeathEndingInput): Promise<void> {
  const { sessionId, worldId, supabase } = input

  try {
    // Find ending_bad nodes for this world
    const { data: endingNodes, error } = await supabase
      .from('story_nodes')
      .select('id, name')
      .eq('world_id', worldId)
      .eq('node_type', 'ending_bad')

    if (error || !endingNodes || endingNodes.length === 0) {
      console.warn('[Node 17B · DeathEnding] 世界中未找到 ending_bad 节点，跳过激活')
      return
    }

    const inserts = (endingNodes as Array<{ id: string; name: string }>).map(n => ({
      session_id: sessionId,
      node_id: n.id,
      status: 'active' as const,
    }))

    const { error: upsertErr } = await supabase
      .from('session_story_state')
      .upsert(inserts, { onConflict: 'session_id,node_id', ignoreDuplicates: true })

    if (upsertErr) {
      console.error('[Node 17B · DeathEnding] 激活死亡结局节点失败:', upsertErr.message)
    } else {
      const names = (endingNodes as Array<{ id: string; name: string }>).map(n => n.name).join(', ')
      console.log(`[Node 17B · DeathEnding] ☠️ 已激活死亡结局节点: ${names}`)
    }
  } catch (err) {
    console.error('[Node 17B · DeathEnding] 意外错误，跳过:', err)
  }
}
