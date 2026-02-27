/**
 * NODE 3F: NPC Memory Loader
 *
 * Loads per-NPC memory records for the current session from `session_npc_memory`.
 * Runs in parallel with Nodes 3A-3E.
 *
 * Fallback: empty array (NPC memory is optional enhancement).
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { NPCMemory } from '../types/npc-agent'
import { EMPTY_NPC_MEMORIES } from '../types/npc-agent'

export type NPCMemoryLoaderInput = {
  sessionId: string
  supabase: SupabaseClient
}

/**
 * Loads all NPC memory rows for this session.
 * Returns NPCMemory[] keyed by npc_id so downstream nodes can match
 * against the RAG-retrieved NPC list.
 */
export async function loadNPCMemories(
  input: NPCMemoryLoaderInput
): Promise<NPCMemory[]> {
  const { sessionId, supabase } = input

  try {
    const { data, error } = await supabase
      .from('session_npc_memory')
      .select(`
        npc_id,
        memories,
        attitude,
        status,
        last_seen_turn,
        npcs ( name )
      `)
      .eq('session_id', sessionId)

    if (error) {
      console.error('[Node 3F · NPCMemory] 数据库查询失败:', error.message)
      return EMPTY_NPC_MEMORIES
    }

    if (!data || data.length === 0) {
      console.log('[Node 3F · NPCMemory] 当前会话无NPC记忆')
      return EMPTY_NPC_MEMORIES
    }

    const memories: NPCMemory[] = data.map((row) => {
      const npcs = row.npcs as { name?: string }[] | { name?: string } | null
      const npcName = Array.isArray(npcs) ? (npcs[0]?.name ?? 'Unknown') : (npcs?.name ?? 'Unknown')
      return {
        npcId: row.npc_id as string,
        npcName,
        memories: (row.memories ?? []) as string[],
        attitude: (row.attitude ?? 'neutral') as string,
        status: (row.status ?? 'alive') as string,
        lastSeenTurn: (row.last_seen_turn ?? 0) as number,
      }
    })

    for (const mem of memories) {
      console.log(
        `[Node 3F · NPCMemory] ${mem.npcName}: 态度=${mem.attitude}, 状态=${mem.status}, ` +
        `记忆(${mem.memories.length}条)=${mem.memories.length > 0 ? mem.memories.join(' | ') : '(无)'}`
      )
    }
    console.log(`[Node 3F · NPCMemory] 共加载 ${memories.length} 个NPC的记忆`)
    return memories

  } catch (err) {
    console.error('[Node 3F · NPCMemory] 出错（非致命）:', err)
    return EMPTY_NPC_MEMORIES
  }
}
