/**
 * NODE 3E: Story State Loader
 *
 * Loads per-session story progress from session_story_state.
 * Finds currently active nodes and the next possible story nodes
 * via story_edges. Also loads the active quest metadata.
 *
 * If no active nodes exist yet (first turn), auto-activates any
 * story_nodes with is_start_node = true for this world.
 *
 * Fallback: returns empty StoryState (initialized = false) on any error.
 */

import { SupabaseClient } from '@supabase/supabase-js'

export type StoryNodeSummary = {
  id: string
  name: string
  description: string
  node_type: string
  interactive_hints: string[]
  completion_trigger: string | null
  is_start_node: boolean
  ending_script?: string | null  // Pre-written ending narration (for ending_good/ending_bad nodes)
  location_id: string | null      // FK to locations — determines what items are accessible
}

export type StoryState = {
  activeNodes: StoryNodeSummary[]
  availableNextNodes: StoryNodeSummary[]
  currentQuestTitle?: string
  currentQuestDescription?: string
  currentQuestType?: string
  initialized: boolean
}

export const EMPTY_STORY_STATE: StoryState = {
  activeNodes: [],
  availableNextNodes: [],
  initialized: false,
}

export type StoryStateLoaderInput = {
  sessionId: string
  supabase: SupabaseClient
}

/**
 * Loads story state for the current session.
 */
export async function loadStoryState(
  input: StoryStateLoaderInput
): Promise<StoryState> {
  const { sessionId, supabase } = input

  try {
    // ── Step 1: Fetch session to get world_id + current_quest_id ────────────
    const { data: sessionRow, error: sessionErr } = await supabase
      .from('sessions')
      .select('world_id, current_quest_id')
      .eq('id', sessionId)
      .single()

    if (sessionErr || !sessionRow) {
      console.warn('[Node 3E · StoryState] 无法获取会话数据:', sessionErr?.message)
      return EMPTY_STORY_STATE
    }

    const worldId: string = sessionRow.world_id
    const currentQuestId: string | null = sessionRow.current_quest_id ?? null

    // ── Step 2: Load active nodes for this session ───────────────────────────
    const { data: activeStateRows } = await supabase
      .from('session_story_state')
      .select(`
        node_id,
        story_nodes (
          id, name, description, node_type,
          interactive_hints, completion_trigger, is_start_node, ending_script, location_id
        )
      `)
      .eq('session_id', sessionId)
      .eq('status', 'active')

    let activeNodes: StoryNodeSummary[] = []
    if (activeStateRows && activeStateRows.length > 0) {
      activeNodes = activeStateRows
        .map((row: Record<string, unknown>): StoryNodeSummary | null => {
          const n = row.story_nodes as Record<string, unknown> | null
          if (!n) return null
          return {
            id: n.id as string,
            name: n.name as string,
            description: n.description as string,
            node_type: (n.node_type as string) ?? 'objective',
            interactive_hints: (n.interactive_hints as string[]) ?? [],
            completion_trigger: (n.completion_trigger as string | null) ?? null,
            is_start_node: (n.is_start_node as boolean) ?? false,
            ending_script: (n.ending_script as string | null) ?? null,
            location_id: (n.location_id as string | null) ?? null,
          }
        })
        .filter((n): n is StoryNodeSummary => n !== null)
    }

    // ── Step 3: If no active nodes, auto-activate start nodes ───────────────
    if (activeNodes.length === 0) {
      const { data: startNodes } = await supabase
        .from('story_nodes')
        .select('id, name, description, node_type, interactive_hints, completion_trigger, is_start_node, location_id')
        .eq('world_id', worldId)
        .eq('is_start_node', true)

      if (startNodes && startNodes.length > 0) {
        // Insert into session_story_state for each start node
        const inserts = startNodes.map((n: Record<string, unknown>) => ({
          session_id: sessionId,
          node_id: n.id as string,
          quest_id: null,
          status: 'active',
        }))

        await supabase
          .from('session_story_state')
          .upsert(inserts, { onConflict: 'session_id,node_id', ignoreDuplicates: true })

        activeNodes = startNodes.map((n: Record<string, unknown>) => ({
          id: n.id as string,
          name: n.name as string,
          description: n.description as string,
          node_type: (n.node_type as string) ?? 'start',
          interactive_hints: (n.interactive_hints as string[]) ?? [],
          completion_trigger: (n.completion_trigger as string | null) ?? null,
          is_start_node: true,
          location_id: (n.location_id as string | null) ?? null,
        }))

        console.log(`[Node 3E · StoryState] 为会话 ${sessionId} 自动激活了 ${activeNodes.length} 个起始节点`)
      }
    }

    // ── Step 4: Load available next nodes via story_edges ───────────────────
    let availableNextNodes: StoryNodeSummary[] = []
    if (activeNodes.length > 0) {
      const activeNodeIds = activeNodes.map(n => n.id)

      const { data: outboundEdges } = await supabase
        .from('story_edges')
        .select(`
          to_node_id,
          edge_type,
          story_nodes!story_edges_to_node_id_fkey (
            id, name, description, node_type,
            interactive_hints, completion_trigger, is_start_node, location_id
          )
        `)
        .in('from_node_id', activeNodeIds)
        .neq('edge_type', 'fail')  // Don't show fail paths as "available"

      if (outboundEdges && outboundEdges.length > 0) {
        const seen = new Set<string>()
        availableNextNodes = outboundEdges
          .map((row: Record<string, unknown>) => {
            const n = row.story_nodes as Record<string, unknown> | null
            if (!n || seen.has(n.id as string)) return null
            seen.add(n.id as string)
            return {
              id: n.id as string,
              name: n.name as string,
              description: n.description as string,
              node_type: (n.node_type as string) ?? 'objective',
              interactive_hints: (n.interactive_hints as string[]) ?? [],
              completion_trigger: (n.completion_trigger as string | null) ?? null,
              is_start_node: (n.is_start_node as boolean) ?? false,
              location_id: (n.location_id as string | null) ?? null,
            } satisfies StoryNodeSummary
          })
          .filter((n): n is StoryNodeSummary => n !== null)
      }
    }

    // ── Step 5: Load current quest metadata ─────────────────────────────────
    let currentQuestTitle: string | undefined
    let currentQuestDescription: string | undefined
    let currentQuestType: string | undefined

    if (currentQuestId) {
      const { data: quest } = await supabase
        .from('quests')
        .select('title, description, quest_type')
        .eq('id', currentQuestId)
        .single()

      if (quest) {
        currentQuestTitle = quest.title
        currentQuestDescription = quest.description || undefined
        currentQuestType = quest.quest_type
      }
    }

    const initialized = activeNodes.length > 0 || availableNextNodes.length > 0

    console.log(
      `[Node 3E · StoryState] 会话 ${sessionId}: ${activeNodes.length} 个活跃节点, ` +
      `${availableNextNodes.length} 个后续节点, 任务=${currentQuestTitle ?? '无'}`
    )

    return {
      activeNodes,
      availableNextNodes,
      currentQuestTitle,
      currentQuestDescription,
      currentQuestType,
      initialized,
    }
  } catch (err) {
    console.error('[Node 3E · StoryState] 意外错误，返回空状态:', err)
    return EMPTY_STORY_STATE
  }
}
