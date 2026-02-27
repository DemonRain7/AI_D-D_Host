/**
 * DM Response Generation Workflow — v3 (Multi-Agent Pipeline + NPC Agent)
 *
 * 20-node pipeline with parallel branches and SSE streaming.
 *
 * Execution order:
 *   [1]          Input Validation
 *   [2A+B]       retrieveData + classifyIntent                       ← parallel
 *   [3A+B+C+D+E+F] RAG + player state + scenario event + milestones + story + NPC memories ← parallel
 *   [4]          validatePreconditions (pure, no DB)
 *   [5]          resolveDice (d12 + custom attribute, no LLM)
 *   [6]          synthesizeOutcome (pure)
 *   [6B]         NPC Action Agent (MODEL_FAST, ~1s)
 *   [7]          assembleContext (merge all data + outcome + milestones + NPC actions)
 *   [8]          constructPrompt
 *   [9]          generateResponse (streaming SSE)
 *   [10]         persistOutput
 *   [11-17+18]   background state updates + NPC memory update (fire-and-forget)
 *   [7]          dynamic field update (after Node 11, avoids race condition)
 *   [19]         narrative state sync — detect items/abilities from DM text (after Node 7)
 */

import { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

import { validateInput } from './nodes/1-input-validation'
import { classifyIntent } from './nodes/2-intent-classifier'
import { retrieveData } from './nodes/2-data-retrieval'
import { retrieveIntentAwareContext } from './nodes/3a-intent-aware-rag'
import { loadPlayerState } from './nodes/3b-player-state-loader'
import { generateScenarioEvent } from './nodes/3c-scenario-event-generator'
import { validatePreconditions } from './nodes/4-precondition-validator'
import { resolveDice } from './nodes/5-dice-engine'
import { synthesizeOutcome } from './nodes/6-outcome-synthesizer'
import type { NpcAbilityForCombat } from './nodes/6-outcome-synthesizer'
import { assembleContext } from './nodes/3-context-assembly'
import { constructPrompt } from './nodes/4-prompt-construction'
import { generateResponse } from './nodes/5-llm-generation'
import { persistOutput } from './nodes/6-output-persistence'
import { analyzeDynamicFieldUpdates } from './nodes/7-dynamic-field-update'
import { applyHPMPChanges } from './nodes/11-hp-mp-updater'
import { applyInventoryChanges } from './nodes/12-inventory-updater'
import { applyStatusEffects } from './nodes/13-status-effect-updater'
import { writeEventLog } from './nodes/14-events-log-writer'
import { applyAttributeGains } from './nodes/15-attribute-updater'
import { detectMilestone } from './nodes/16-milestone-detector'
import { checkStoryNodeCompletion, activateDeathEnding } from './nodes/17-story-node-completion'
import { EMPTY_PLAYER_STATE } from './types/player-state'
import { NULL_SCENARIO_EVENT } from './types/custom-dice'
import { FALLBACK_DICE } from './types/game-mechanics'
import type { SessionMilestone, LocationBoundItem, CombatLootItem } from './nodes/3-context-assembly'
import { loadStoryState, EMPTY_STORY_STATE } from './nodes/3e-story-state-loader'
import { loadNPCMemories } from './nodes/3f-npc-memory-loader'
import { generateNPCActions } from './nodes/6b-npc-action-agent'
import { selectNpcCombatStrategy } from './nodes/6c-npc-combat-strategy-agent'
import { updateNPCMemories } from './nodes/18-npc-memory-updater'
import { EMPTY_NPC_MEMORIES } from './types/npc-agent'
import { syncNarrativeState } from './nodes/19-narrative-state-sync'
import { parseEquipCommands, executeEquipActions } from './nodes/19b-equipment-manager'
import { handleMetaAction } from './nodes/2c-meta-handler'
import { validateActionValidity } from './nodes/0-action-validity-gate'
import { buildCombatModeDirective } from './prompts'
import { MODEL_FAST } from '@/lib/config'

export type WorkflowInput = {
  sessionId: string | undefined
  playerMessage: string | undefined
  supabase: SupabaseClient
  openai: OpenAI
  onChunk?: (chunk: string) => void
  onMeta?: (meta: WorkflowMetaEvent) => void
}

export type WorkflowMetaEvent = {
  type: 'intent' | 'dice' | 'outcome' | 'scenario' | 'status' | 'equipment' | 'game_over' | 'game_complete' | 'combat_info' | 'combat_end' | 'combat_start' | 'combat_victory'
  data: Record<string, unknown>
}

export type WorkflowOutput = {
  dmResponse: string
  messageId: string | null
}

/**
 * Executes the full 15-node multi-agent DM response workflow.
 */
export async function executeDMResponseWorkflow(
  input: WorkflowInput
): Promise<WorkflowOutput> {
  const { sessionId, playerMessage, supabase, openai, onChunk, onMeta } = input
  const turnStartedAt = Date.now()

  // ── NODE 1: Input Validation ─────────────────────────────────────────────
  const { sessionId: sid, playerMessage: msg } = await validateInput({ sessionId, playerMessage })

  // ── NODES 2A+2B: Parallel — base data retrieval + intent classification ──
  onMeta?.({ type: 'status', data: { message: '分析行动意图...' } })
  // classifyIntent with empty history is acceptable; intent routing is the goal.
  // retrieveData fetches world/player/messageHistory/entities from DB.
  const [baseData, intent] = await Promise.all([
    retrieveData({ sessionId: sid, playerMessage: msg, supabase, openai }),
    classifyIntent({ playerMessage: msg, recentHistory: [], openai }),
  ])

  onMeta?.({
    type: 'intent',
    data: { intent: intent.intent, confidence: intent.confidence, entities: intent.mentionedEntities },
  })

  // ── META Short-Circuit: template responses skip the full LLM pipeline ─────
  if (intent.intent === 'META') {
    const metaPlayerState = await loadPlayerState({ sessionId: sid, supabase }).catch(() => null)
    const metaResult = handleMetaAction(msg, metaPlayerState ?? EMPTY_PLAYER_STATE, (baseData.world as { name?: string }).name ?? '')

    if (metaResult) {
      onMeta?.({ type: 'status', data: { message: '查询玩家信息...' } })
      onChunk?.(metaResult.response)
      onMeta?.({ type: 'status', data: { message: '状态更新完成' } })
      const output = await persistOutput({ sessionId: sid, dmResponse: metaResult.response, supabase })
      return output
    }
    // null → HELP/GENERAL, fall through to full pipeline
  }

  const worldId = baseData.world.id
  const worldSetting = (baseData.world as { setting?: string }).setting ?? ''

  // Build recent messages for downstream nodes
  const recentMessages = (baseData.messageHistory ?? [])
    .slice(0, 5)
    .map(m => ({ author: m.author, content: m.content }))

  // ── NODE 3B: Player State Loader (first — other parallel nodes depend on its attrs) ──────
  onMeta?.({ type: 'status', data: { message: '检索世界背景...' } })
  const playerState = await loadPlayerState({ sessionId: sid, supabase }).catch((err: unknown) => {
    console.error('[Workflow · Node 3B] 玩家状态加载失败，使用空状态:', err)
    return null
  })
  const effectivePlayerState = playerState ?? EMPTY_PLAYER_STATE

  // ── Pre-check: is there an NPC in active combat? (lightweight, for Node 3C context) ─
  const { data: preCombatNpc } = await supabase
    .from('session_npc_stats')
    .select('npc_id')
    .eq('session_id', sid)
    .eq('in_combat', true)
    .eq('is_alive', true)
    .limit(1)
    .maybeSingle()
  const preInCombat = !!preCombatNpc

  // ── NODES 3A+3C+3D+3E+3F: Parallel — RAG + scenario event + milestones + story state + NPC memories ─
  // Node 3B is done above; effectivePlayerState.customAttributes now feeds into Node 3C for DC calibration.
  const [intentEntities, scenarioEvent, recentMilestones, storyState, npcMemories] = await Promise.all([
    retrieveIntentAwareContext({
      playerMessage: msg,
      recentMessages,
      worldId,
      intent: intent.intent,
      supabase,
      openai,
    }).catch((err: unknown) => {
      console.error('[Workflow · Node 3A] 意图感知RAG失败，使用基础实体:', err)
      return null
    }),
    generateScenarioEvent({
      playerMessage: msg,
      recentHistory: recentMessages,
      worldSetting,
      intent,
      playerAttributeValues: effectivePlayerState.customAttributes,
      inCombat: preInCombat,
      openai,
    }).catch((err: unknown) => {
      console.error('[Workflow · Node 3C] 场景事件生成失败，使用空事件:', err)
      return NULL_SCENARIO_EVENT
    }),
    // Node 3D: Load last 5 milestones for long-term story memory
    (async (): Promise<SessionMilestone[]> => {
      try {
        const { data } = await supabase
          .from('session_milestones')
          .select('event_summary, event_type, total_score, created_at, turn_number')
          .eq('session_id', sid)
          .order('created_at', { ascending: false })
          .limit(5)
        // Reverse so context reads oldest → newest (chronological)
        return ((data ?? []) as SessionMilestone[]).reverse()
      } catch (err) {
        console.error('[Workflow · Node 3D] 里程碑加载失败，使用空数组:', err)
        return []
      }
    })(),
    // Node 3E: Load quest + story node state for this session
    loadStoryState({ sessionId: sid, supabase }).catch((err: unknown) => {
      console.error('[Workflow · Node 3E] 故事状态加载失败，使用空状态:', err)
      return EMPTY_STORY_STATE
    }),
    // Node 3F: Load NPC memories for this session
    loadNPCMemories({ sessionId: sid, supabase }).catch((err: unknown) => {
      console.error('[Workflow · Node 3F] NPC记忆加载失败，使用空数组:', err)
      return EMPTY_NPC_MEMORIES
    }),
  ])

  let effectiveScenarioEvent = scenarioEvent ?? NULL_SCENARIO_EVENT

  // ── Player Location: load & auto-init current_location_id ──────────────
  let currentLocationId: string | null = null
  let currentLocationName: string | null = null
  {
    const { data: sessionRow, error: sessLocErr } = await supabase
      .from('sessions')
      .select('current_location_id')
      .eq('id', sid)
      .single()

    if (sessLocErr) {
      console.error(`[Workflow · Location] ❌ 查询 sessions.current_location_id 失败:`, sessLocErr.message)
    }
    currentLocationId = (sessionRow as { current_location_id?: string | null } | null)?.current_location_id ?? null
    console.log(`[Workflow · Location] DB 中的 current_location_id = ${currentLocationId ?? 'NULL'}`)

    // Auto-init: try active nodes, then available nodes, then all world locations
    if (!currentLocationId) {
      const allNodes = [
        ...(storyState?.activeNodes ?? []),
        ...(storyState?.availableNextNodes ?? []),
      ]
      const initLocId = allNodes.map(n => n.location_id).find((id): id is string => !!id)
      if (initLocId) {
        await supabase.from('sessions').update({ current_location_id: initLocId }).eq('id', sid)
        currentLocationId = initLocId
        console.log(`[Workflow · Location] 从故事节点自动初始化 → ${initLocId}`)
      } else {
        // Last resort: pick the first location in the world
        const { data: firstLoc } = await supabase
          .from('locations')
          .select('id, name')
          .eq('world_id', worldId)
          .limit(1)
          .maybeSingle()
        if (firstLoc) {
          await supabase.from('sessions').update({ current_location_id: firstLoc.id }).eq('id', sid)
          currentLocationId = firstLoc.id
          console.log(`[Workflow · Location] 使用世界首个地点兜底初始化 → ${firstLoc.name} (${firstLoc.id})`)
        } else {
          console.warn(`[Workflow · Location] ⚠️ 世界中没有任何 location，位置系统无法工作`)
        }
      }
    }

    // Resolve location name for context
    if (currentLocationId) {
      const { data: locRow } = await supabase
        .from('locations')
        .select('name')
        .eq('id', currentLocationId)
        .single()
      currentLocationName = (locRow as { name: string } | null)?.name ?? null
    }
    console.log(`[Workflow · Location] 最终位置: ${currentLocationName ?? '未知'} (${currentLocationId ?? 'NULL'})`)
  }

  // ── Explicit location change: regex + hint mapping (pre-DM) ──────────────
  // Collects all story nodes' location_ids and interactive_hints to build a mapping.
  // Matches player movement verbs against location names, aliases, AND scene hints.
  // Post-DM: LLM fallback runs if regex didn't detect movement (see Phase 5 below).
  const allStoryNodes = [
    ...(storyState?.activeNodes ?? []),
    ...(storyState?.availableNextNodes ?? []),
  ]
  let preMovedByRegex = false
  let availableLocations: Array<{ id: string; name: string }> = []
  if (currentLocationId) {
    const connectedLocIds = allStoryNodes
      .map(n => n.location_id)
      .filter((id): id is string => !!id && id !== currentLocationId)
    const uniqueOtherLocIds = [...new Set(connectedLocIds)]

    if (uniqueOtherLocIds.length > 0) {
      const { data: otherLocs } = await supabase
        .from('locations')
        .select('id, name, aliases')
        .in('id', uniqueOtherLocIds)
      availableLocations = ((otherLocs ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>)
        .map(l => ({ id: l.id, name: l.name }))

      // Build hint → location_id mapping from story nodes
      const hintToLocId = new Map<string, string>()
      for (const node of allStoryNodes) {
        if (node.location_id && node.location_id !== currentLocationId && node.interactive_hints) {
          for (const hint of node.interactive_hints) {
            hintToLocId.set(hint.toLowerCase(), node.location_id)
          }
        }
      }

      // Extract location keyword after movement verbs for bidirectional matching
      const moveMatch = msg.match(/(?:进入|去|到|前往|走向|移动到|回到|来到|踏入|走进|走入|闯入|穿过|通过|钻入|跑向|奔向|爬入|跳入|潜入|溜进|开门|推门|打开)\s*(.+?)(?:[，。！？\s]|$)/)
      const locationKeyword = moveMatch?.[1]?.trim()

      // Check for "leave" verbs
      const leaveMatch = msg.match(/(?:走出|离开|退出|逃离|逃出|出去|返回)\s*(.+?)(?:[，。！？\s]|$)/)
      const leaveKeyword = leaveMatch?.[1]?.trim()

      // Pass 1: match movement-verb keyword against location names/aliases
      // IMPORTANT: Only match when a movement verb (进入/去/到 etc.) is present.
      // Raw msg.includes(name) is too broad — "离开密室" would incorrectly move TO 密室.
      for (const loc of (otherLocs ?? []) as Array<{ id: string; name: string; aliases?: string[] | null }>) {
        const names = [loc.name, ...(loc.aliases ?? [])]
        const mentioned = locationKeyword && locationKeyword.length >= 2 &&
          names.some(n => n.includes(locationKeyword) || locationKeyword.includes(n))
        if (mentioned) {
          await supabase.from('sessions').update({ current_location_id: loc.id }).eq('id', sid)
          currentLocationId = loc.id
          currentLocationName = loc.name
          console.log(`[Workflow · Location] 玩家显式移动 → ${loc.name} (${loc.id})`)
          preMovedByRegex = true
          break
        }
      }

      // Pass 2: match movement keyword against interactive_hints → resolve to location
      if (!preMovedByRegex && locationKeyword && locationKeyword.length >= 2) {
        for (const [hint, locId] of hintToLocId) {
          if (hint.includes(locationKeyword.toLowerCase()) || locationKeyword.toLowerCase().includes(hint)) {
            const destLoc = (otherLocs ?? []).find((l: { id: string }) => l.id === locId) as { id: string; name: string } | undefined
            if (destLoc) {
              await supabase.from('sessions').update({ current_location_id: destLoc.id }).eq('id', sid)
              currentLocationId = destLoc.id
              currentLocationName = destLoc.name
              console.log(`[Workflow · Location] 玩家通过场景元素「${hint}」移动 → ${destLoc.name} (${destLoc.id})`)
              preMovedByRegex = true
              break
            }
          }
        }
      }

      // Pass 3: "leave" fallback — move to first connected location
      if (!preMovedByRegex && leaveKeyword && leaveKeyword.length >= 2 && currentLocationName) {
        const isLeavingCurrent = currentLocationName.includes(leaveKeyword) || leaveKeyword.includes(currentLocationName)
        if (isLeavingCurrent && (otherLocs ?? []).length > 0) {
          const dest = (otherLocs as Array<{ id: string; name: string }>)[0]
          await supabase.from('sessions').update({ current_location_id: dest.id }).eq('id', sid)
          currentLocationId = dest.id
          currentLocationName = dest.name
          console.log(`[Workflow · Location] 玩家离开当前位置 → ${dest.name} (${dest.id})`)
          preMovedByRegex = true
        }
      }
    }
  }

  // ── Collect active/completed node IDs for unlock checks ────────────────
  const activeNodeIds = new Set(
    (storyState?.activeNodes ?? []).map(n => n.id)
  )
  // Also include completed nodes (unlock_node_id is a one-time unlock)
  const completedNodeIds = new Set<string>()
  {
    const { data: completedRows } = await supabase
      .from('session_story_state')
      .select('node_id')
      .eq('session_id', sid)
      .eq('status', 'completed')
    for (const r of (completedRows ?? []) as Array<{ node_id: string }>) {
      completedNodeIds.add(r.node_id)
    }
  }
  const unlockedNodeIds = new Set([...activeNodeIds, ...completedNodeIds])

  // ── NODE 0: Action Validity Gate ──────────────────────────────────────────
  // Pre-pipeline check: does the player's ITEM_USE reference an accessible item?
  // If not (not found OR locked) → short-circuit with a rejection message.
  {
    const gateResult = await validateActionValidity({
      playerMessage: msg,
      intent: intent.intent,
      sessionId: sid,
      worldId,
      currentLocationId,
      currentLocationName,
      unlockedNodeIds,
      supabase,
      openai,
    })

    if (gateResult.blocked) {
      console.log(`[Node 0 · Gate] ❌ 拦截: ${gateResult.rejectionMessage}`)
      onChunk?.(gateResult.rejectionMessage ?? '')
      const output = await persistOutput({
        sessionId: sid,
        dmResponse: gateResult.rejectionMessage ?? '',
        supabase,
      })
      return output
    }
  }

  // ── Vague target rejection ──────────────────────────────────────────────
  // If the player uses vague words like "敌人/怪物/对手" instead of a specific
  // entity name, reject immediately. Attacks must target a named entity.
  // Search the RAW message with regex (not entity exact match) so compound
  // phrases like "将落雷降于敌人身上" still get caught.
  // Exception: skip if a known NPC name appears in the message — the vague word
  // might be part of a proper name (e.g. "怪物猎人", "最终敌人").
  {
    const VAGUE_TARGET_RE = /(敌人|对手|怪物|怪兽|敌方|所有敌人|全部敌人|enemy|enemies|monster|monsters|opponent|foe|foes)/i
    const HAS_COMBAT_VERB = /(攻击|打击|打|砍|刺|射击|射|杀|击打|轰|对付|降于|击|斩|劈|attack|strike|hit|kill|fight)/i
    const hasVagueTarget = VAGUE_TARGET_RE.test(msg)
    const isCombatLike = intent.intent === 'COMBAT' || intent.intent === 'SPELL_CAST' || intent.intent === 'ITEM_USE' || HAS_COMBAT_VERB.test(msg)
    // Don't block if the message contains a known NPC name (avoids false positives
    // for NPCs with names like "怪物猎人" or "最终敌人")
    const knownNpcNames = (baseData.npcs ?? []).map(n => n.name?.toLowerCase()).filter(Boolean)
    const msgLower = msg.toLowerCase()
    const mentionsKnownNpc = knownNpcNames.some(name => msgLower.includes(name))
    if (hasVagueTarget && isCombatLike && !mentionsKnownNpc) {
      const rejectMsg = '⚠️ 请指明攻击对象的具体名称（如「幻影刺客」），不要使用"敌人"、"怪物"等模糊说法。你可以先观察四周来了解场景中有哪些目标。'
      console.log(`[Workflow · VagueTarget] ❌ 拦截: 模糊目标检测于原文: "${msg}"`)
      onChunk?.(rejectMsg)
      const output = await persistOutput({ sessionId: sid, dmResponse: rejectMsg, supabase })
      return output
    }
  }

  // ── Location-bound item fetch (authoritative, based on player's current_location_id) ──
  // Only fetch items at the player's CURRENT location, excluding owned items
  // and items whose unlock_node_id has not been reached yet.
  const locationBoundItems = new Map<string, LocationBoundItem[]>()
  // ALL item names + aliases at this location — used to strip hardcoded item
  // references from the static location description text so items are fully dynamic.
  const allLocationItemNames: string[] = []

  if (currentLocationId) {
    try {
      const [{ data: locItems }, { data: playerInv }] = await Promise.all([
        supabase
          .from('items')
          .select('id, name, description, item_stats, location_id, unlock_node_id, aliases')
          .eq('location_id', currentLocationId),
        supabase
          .from('player_inventory')
          .select('item_id')
          .eq('session_id', sid),
      ])

      // Collect ALL item names + aliases for stripping from description
      for (const item of (locItems ?? []) as Array<{ name: string; aliases?: string[] }>) {
        allLocationItemNames.push(item.name)
        if (item.aliases) allLocationItemNames.push(...item.aliases)
      }

      const ownedIds = new Set(
        (playerInv ?? []).map((r: { item_id?: string }) => r.item_id).filter(Boolean)
      )

      for (const item of (locItems ?? []) as Array<{ id: string; name: string; description: string; item_stats: Record<string, unknown> | null; location_id: string; unlock_node_id: string | null }>) {
        if (ownedIds.has(item.id)) continue
        // Lock check: if item has unlock_node_id, it must be active or completed
        if (item.unlock_node_id && !unlockedNodeIds.has(item.unlock_node_id)) continue
        const locId = item.location_id
        if (!locationBoundItems.has(locId)) locationBoundItems.set(locId, [])
        locationBoundItems.get(locId)!.push({
          id: item.id,
          name: item.name,
          description: item.description,
          item_stats: item.item_stats,
        })
      }

      if (locationBoundItems.size > 0) {
        console.log(`[Workflow · LocationItems] 当前位置 ${currentLocationId}: ${[...locationBoundItems.values()].reduce((s, a) => s + a.length, 0)} 件可获取物品`)
      }
    } catch (err) {
      console.warn('[Workflow · LocationItems] 地点物品加载失败，跳过:', err)
    }
  }

  // ── COMBAT: Equip/Unequip = wasted turn ─────────────────────────────────
  // Equipping items during combat is a non-action. No dice roll, NPC gets free attack.
  // Consumables (ITEM_USE) are still allowed.
  const isEquipActionInCombat = preInCombat && /装备|穿上|戴上|握住|装上|换上|佩戴|穿戴|换装|披上|套上|穿|戴|卸下|脱下|摘下|取下|换下|放下|卸掉|解除装备/.test(msg)
    && intent.intent !== 'ITEM_USE' // allow consumable items
    && intent.intent !== 'COMBAT'   // allow actual attacks that happen to mention equip words

  if (isEquipActionInCombat) {
    console.log(`[Workflow] ⚠️ 战斗中尝试装卸装备 → 视为浪费回合（不触发骰子，NPC趁机攻击）`)
    effectiveScenarioEvent = { ...effectiveScenarioEvent, triggered: false }
  }

  // ── COMBAT SAFETY NET ──────────────────────────────────────────────────
  // Node 3C is an LLM and sometimes sets triggered=false even during active
  // combat. In combat, dice MUST always roll. Uses preInCombat from earlier check.
  // Exception: equip actions are already handled above as wasted turns.
  if (preInCombat && !effectiveScenarioEvent.triggered && !isEquipActionInCombat) {
    // Use WIT dice for spell casts, COMBAT for everything else
    const combatDiceType = intent.intent === 'SPELL_CAST' ? 'WIT' as const : 'COMBAT' as const
    console.warn(`[Workflow] ⚠️ 战斗中 Node 3C 未触发场景事件 → 强制触发 ${combatDiceType} 骰`)
    effectiveScenarioEvent = {
      ...effectiveScenarioEvent,
      triggered: true,
      diceType: combatDiceType,
      dc: effectiveScenarioEvent.dc > 0 ? effectiveScenarioEvent.dc : 6,
      eventTitle: effectiveScenarioEvent.eventTitle || (combatDiceType === 'WIT' ? '施法行动' : '战斗行动'),
      eventDescription: effectiveScenarioEvent.eventDescription || '战斗中的行动判定',
      successNarrative: effectiveScenarioEvent.successNarrative || (combatDiceType === 'WIT' ? '法术命中，造成魔法伤害' : '攻击命中，造成伤害'),
      failureNarrative: effectiveScenarioEvent.failureNarrative || '攻击未能命中，敌人趁机反击',
    }
  }

  // ── RETRY PENALTY: increase DC on repeated failures at same location ────
  // Query recent failures with same dice_type at same location.
  // Combat is exempt (each combat round is independent).
  let retryBlocked = false
  let retryBlockMessage = ''

  if (effectiveScenarioEvent.triggered && !preInCombat && currentLocationId) {
    try {
      const { count } = await supabase
        .from('session_events')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sid)
        .eq('dice_type', effectiveScenarioEvent.diceType)
        .eq('location_id', currentLocationId)
        .eq('roll_required', true)
        .in('outcome_type', ['FAILURE', 'CRITICAL_FAILURE'])

      const failureCount = count ?? 0

      if (failureCount >= 3) {
        retryBlocked = true
        retryBlockMessage = '你已经在这里反复尝试过了，但每次都以失败告终。也许该换个思路，或者先去别处看看。'
        console.log(`[Workflow · RetryPenalty] ✖ ${effectiveScenarioEvent.diceType}: ${failureCount}次失败 → 自动拒绝`)
        effectiveScenarioEvent = { ...effectiveScenarioEvent, triggered: false }
      } else if (failureCount > 0) {
        const penalty = failureCount * 2
        const newDc = effectiveScenarioEvent.dc + penalty
        console.log(`[Workflow · RetryPenalty] ${effectiveScenarioEvent.diceType}: ${failureCount}次失败 → DC+${penalty}=${newDc}`)
        effectiveScenarioEvent = { ...effectiveScenarioEvent, dc: newDc }
      }
    } catch (err) {
      console.warn('[Workflow · RetryPenalty] 查询失败，跳过惩罚:', err)
    }
  }

  // Short-circuit: retry limit exceeded → stream rejection and return
  if (retryBlocked) {
    onChunk?.(retryBlockMessage)
    await writeEventLog({
      sessionId: sid,
      playerMessage: msg,
      intent,
      dice: { ...FALLBACK_DICE },
      outcome: { outcome: 'FAILURE' as const, mechanicalEffects: [], narrativeHint: retryBlockMessage },
      appliedEffects: [],
      dmResponse: retryBlockMessage,
      turnStartedAt,
      diceType: effectiveScenarioEvent.diceType,
      locationId: currentLocationId,
      supabase,
    })
    return { dmResponse: retryBlockMessage, messageId: null }
  }

  if (effectiveScenarioEvent.triggered) {
    onMeta?.({
      type: 'scenario',
      data: {
        eventTitle: effectiveScenarioEvent.eventTitle,
        diceType:   effectiveScenarioEvent.diceType,
        dc:         effectiveScenarioEvent.dc,
      },
    })
  }

  // ── NODE 4: Precondition Validator (pure — no DB needed) ─────────────────
  // Collect location-bound item names for pickup validation
  const locationItemNames: string[] = []
  if (currentLocationId && locationBoundItems.has(currentLocationId)) {
    for (const item of locationBoundItems.get(currentLocationId)!) {
      locationItemNames.push(item.name)
    }
  }

  // Collect NPC names from RAG for scene coherence — NPCs may appear dynamically
  // through story events and won't be in static interactive_hints
  const worldNpcNames = (intentEntities?.npcs ?? baseData.npcs ?? []).flatMap(n => [n.name, ...(n.aliases ?? [])]).filter(Boolean)

  // If already in combat, ensure the active combat NPC is in worldNpcNames —
  // RAG may return 0 NPCs on some queries, but we KNOW the combat target is "in the scene"
  if (preInCombat && preCombatNpc?.npc_id) {
    const combatNpcWorld = (baseData.npcs ?? []).find(n => n.id === preCombatNpc.npc_id)
    if (combatNpcWorld) {
      const combatNames = [combatNpcWorld.name, ...(combatNpcWorld.aliases ?? [])].filter(Boolean)
      for (const cn of combatNames) {
        if (!worldNpcNames.includes(cn)) worldNpcNames.push(cn)
      }
    }
  }
  const precondition = await validatePreconditions({ intent, playerState: effectivePlayerState, storyState, locationItemNames, worldNpcNames })

  // ── NODE 5: Dice Engine (d12 + custom attribute) ─────────────────────────
  const dice = await resolveDice({
    precondition,
    playerState: effectivePlayerState,
    scenarioEvent: effectiveScenarioEvent,
  })

  if (dice.rollRequired) {
    onMeta?.({
      type: 'dice',
      data: {
        roll:        dice.rawRoll,
        modifier:    dice.modifier,
        total:       dice.total,
        dc:          dice.dc,
        critSuccess: dice.isCriticalSuccess,
        critFail:    dice.isCriticalFailure,
        diceType:    effectiveScenarioEvent.diceType,
      },
    })
  }

  // ── NODE 6 Pre: Equipment + NPC Lookup (ALL intents) ────────────────────
  // Loads player equipped items (ATK/DEF bonuses) and target NPC stats/abilities.
  // Runs for all intents — equipment context is useful for SOCIAL, SPELL_CAST, etc.
  let equipATKBonus = 0
  let equipDEFBonus = 0
  let targetNpcCombatStats: { npcId: string; attack: number; defense: number; currentMp?: number } | undefined
  const npcAbilities: NpcAbilityForCombat[] = []
  let npcCurrentHp = 10
  let npcMaxHp = 10
  // Combat state is tracked by session_npc_stats.in_combat (not derived from is_alive/is_hostile)
  const npcEquipmentDisplay: Array<{ name: string; slot: string }> = []

  // Fetch player's equipped items (exclude abilities — they use slot_type='ability' but aren't equipment)
  const { data: equipped } = await supabase
    .from('player_inventory')
    .select('item_name, slot_type, items(item_stats)')
    .eq('session_id', sid)
    .eq('equipped', true)
    .neq('slot_type', 'ability')
  const equippedItemDetails: Array<{ name: string; slot: string; atk: number; def: number; special: string }> = []
  for (const row of equipped ?? []) {
    const typedRow = row as { item_name: string; slot_type: string; items?: { item_stats?: Record<string, unknown> } | null }
    const stats = typedRow.items?.item_stats
    const atk = typeof stats?.atk_bonus === 'number' ? stats.atk_bonus : 0
    const def = typeof stats?.def_bonus === 'number' ? stats.def_bonus : 0
    equipATKBonus += atk
    equipDEFBonus += def
    equippedItemDetails.push({
      name: typedRow.item_name,
      slot: typedRow.slot_type ?? '',
      atk, def,
      special: typeof stats?.special_effect === 'string' ? stats.special_effect : '',
    })
  }

  // Player total ATK/DEF = base (from player_core_stats) + equipment bonuses
  const playerTotalATK = effectivePlayerState.attack + equipATKBonus
  const playerTotalDEF = effectivePlayerState.defense + equipDEFBonus

  // Emit equipment SSE event
  if (equippedItemDetails.length > 0) {
    onMeta?.({
      type: 'equipment',
      data: {
        items: equippedItemDetails,
        totalATK: playerTotalATK,
        totalDEF: playerTotalDEF,
      },
    })
  }

  // Extract target NPC from RAG results — prioritize the NPC the player actually named
  const relevantNpcsForCombat = intentEntities?.npcs ?? []
  const normForMatch = (s: string) => s.replace(/[「」『』【】\[\]()（）·•・\-—]/g, '').replace(/\s+/g, '').toLowerCase()
  const playerTargetNames = [
    ...(intent.targetEntity ? [intent.targetEntity] : []),
    ...intent.mentionedEntities,
  ].map(s => normForMatch(s)).filter(Boolean)

  // Helper: check if any of an NPC's names (name + aliases) match any player target
  const npcMatchesPlayer = (n: { name: string; aliases?: string[] }) => {
    const allNames = [n.name, ...(n.aliases ?? [])].map(normForMatch)
    return playerTargetNames.some(t => allNames.some(nn => nn.includes(t) || t.includes(nn)))
  }

  // 1st priority: match NPC by player's targetEntity / mentionedEntities (name + aliases)
  let targetNpc = relevantNpcsForCombat.find(n => npcMatchesPlayer(n))
  // 2nd priority: hostile NPC (e.g. player said "攻击" without specifying)
  if (!targetNpc) targetNpc = relevantNpcsForCombat.find(n => n.combat_stats?.is_hostile)
  // 3rd priority: first NPC from RAG
  if (!targetNpc) targetNpc = relevantNpcsForCombat[0]

  const playerExplicitlyNamedTarget = targetNpc ? npcMatchesPlayer(targetNpc) : false

  // Fallback: RAG missed the NPC but intent targets one by name → direct DB lookup
  if (!targetNpc?.combat_stats?.is_hostile && (intent.intent === 'SPELL_CAST' || intent.intent === 'COMBAT')) {
    const targetName = intent.targetEntity ?? intent.mentionedEntities[0]
    if (targetName) {
      const { data: directNpc } = await supabase
        .from('npcs')
        .select('id, name, description, combat_stats')
        .eq('world_id', worldId)
        .ilike('name', `%${targetName}%`)
        .limit(1)
        .maybeSingle()
      if (directNpc?.combat_stats) {
        targetNpc = directNpc as import('./nodes/2-data-retrieval').NPC
        console.log(`[Workflow] 🔍 RAG未返回目标NPC「${targetName}」→ 直接DB查找: ${directNpc.name} (is_hostile=${directNpc.combat_stats.is_hostile})`)
      }
    }
  }

  if (targetNpc?.id && targetNpc.combat_stats) {
    // Load NPC's current HP/MP from session_npc_stats (if previously engaged in combat)
    let currentMp: number | undefined
    const { data: npcSession } = await supabase
      .from('session_npc_stats')
      .select('current_hp, max_hp, current_mp, is_alive')
      .eq('session_id', sid)
      .eq('npc_id', targetNpc.id)
      .maybeSingle()
    if (npcSession) {
      currentMp = npcSession.current_mp ?? undefined
      npcCurrentHp = npcSession.current_hp ?? targetNpc.combat_stats.max_hp ?? 10
      npcMaxHp = npcSession.max_hp ?? targetNpc.combat_stats.max_hp ?? 10
    } else {
      currentMp = targetNpc.combat_stats.max_mp ?? undefined
      npcCurrentHp = targetNpc.combat_stats.max_hp ?? 10
      npcMaxHp = targetNpc.combat_stats.max_hp ?? 10
    }

    // Load NPC equipment bonuses from npc_equipment table
    let npcEquipATK = 0
    let npcEquipDEF = 0
    const { data: npcEquipRows } = await supabase
      .from('npc_equipment')
      .select('slot_type, items(name, item_stats)')
      .eq('npc_id', targetNpc.id)
    for (const row of npcEquipRows ?? []) {
      const typedRow = row as { slot_type?: string; items?: { name?: string; item_stats?: Record<string, unknown> } | null }
      const eqStats = typedRow.items?.item_stats
      if (typeof eqStats?.atk_bonus === 'number') npcEquipATK += eqStats.atk_bonus
      if (typeof eqStats?.def_bonus === 'number') npcEquipDEF += eqStats.def_bonus
      if (typedRow.items?.name) {
        npcEquipmentDisplay.push({ name: typedRow.items.name, slot: typedRow.slot_type ?? '' })
      }
    }

    targetNpcCombatStats = {
      npcId: targetNpc.id,
      attack: targetNpc.combat_stats.attack + npcEquipATK,
      defense: targetNpc.combat_stats.defense + npcEquipDEF,
      currentMp,
    }

    // Load NPC's linked abilities from npc_abilities junction table
    const { data: abilityRows } = await supabase
      .from('npc_abilities')
      .select('abilities(name, ability_stats)')
      .eq('npc_id', targetNpc.id)
    for (const row of abilityRows ?? []) {
      const ability = (row as { abilities?: { name?: string; ability_stats?: Record<string, unknown> } | null }).abilities
      if (ability?.name && ability.ability_stats) {
        npcAbilities.push({
          name: ability.name,
          damage: Number(ability.ability_stats.damage ?? 0),
          mp_cost: Number(ability.ability_stats.mp_cost ?? 0),
          hp_restore: Number(ability.ability_stats.hp_restore ?? 0),
        })
      }
    }
  }
  console.log(
    `[Workflow · Equipment/NPC] 玩家ATK=${playerTotalATK}(base${effectivePlayerState.attack}+equip${equipATKBonus}) DEF=${playerTotalDEF}(base${effectivePlayerState.defense}+equip${equipDEFBonus})` +
    (targetNpcCombatStats ? ` NPC=${targetNpcCombatStats.npcId} ATK=${targetNpcCombatStats.attack} DEF=${targetNpcCombatStats.defense} MP=${targetNpcCombatStats.currentMp ?? '?'}` : ' 无目标NPC') +
    (npcAbilities.length > 0 ? ` 技能=[${npcAbilities.map(a => `${a.name}(${a.damage}dmg/${a.mp_cost}mp)`).join(', ')}]` : '')
  )

  // ── COMBAT STATE DETECTION ──────────────────────────────────────────────
  // Single source of truth: session_npc_stats.in_combat = true
  // This replaces all RAG/is_hostile heuristics with a persistent DB flag.
  let inCombat = false
  let isFirstCombatEncounter = false
  let combatNpcName = 'NPC'
  let combatNpcId: string | null = null   // Passed to Node 11 for in_combat management

  // Path 1: Check DB for any NPC already in active combat
  const { data: activeCombatNpc } = await supabase
    .from('session_npc_stats')
    .select('npc_id, current_hp, max_hp, current_mp, max_mp')
    .eq('session_id', sid)
    .eq('in_combat', true)
    .eq('is_alive', true)
    .limit(1)
    .maybeSingle()

  if (activeCombatNpc) {
    // Ongoing combat from a previous turn — source of truth is the DB flag
    // CRITICAL: Override targetNpc/stats/abilities to match the COMBAT NPC (not RAG result)
    inCombat = true
    combatNpcId = activeCombatNpc.npc_id
    const combatNpcFromWorld = (baseData.npcs ?? []).find(n => n.id === activeCombatNpc.npc_id)
    combatNpcName = combatNpcFromWorld?.name ?? 'NPC'
    // Override HP from DB
    npcCurrentHp = activeCombatNpc.current_hp ?? npcCurrentHp
    npcMaxHp = activeCombatNpc.max_hp ?? npcMaxHp
    // Reload NPC combat stats + abilities for the correct combat NPC (may differ from RAG target)
    if (combatNpcFromWorld?.id && combatNpcFromWorld.combat_stats) {
      // Reload equipment bonuses for combat NPC
      let combatNpcEquipATK = 0
      let combatNpcEquipDEF = 0
      const { data: combatNpcEquipRows } = await supabase
        .from('npc_equipment')
        .select('slot_type, items(name, item_stats)')
        .eq('npc_id', combatNpcFromWorld.id)
      npcEquipmentDisplay.length = 0  // Clear and repopulate
      for (const row of combatNpcEquipRows ?? []) {
        const typedRow = row as { slot_type?: string; items?: { name?: string; item_stats?: Record<string, unknown> } | null }
        const eqStats = typedRow.items?.item_stats
        if (typeof eqStats?.atk_bonus === 'number') combatNpcEquipATK += eqStats.atk_bonus
        if (typeof eqStats?.def_bonus === 'number') combatNpcEquipDEF += eqStats.def_bonus
        if (typedRow.items?.name) {
          npcEquipmentDisplay.push({ name: typedRow.items.name, slot: typedRow.slot_type ?? '' })
        }
      }
      targetNpcCombatStats = {
        npcId: combatNpcFromWorld.id,
        attack: combatNpcFromWorld.combat_stats.attack + combatNpcEquipATK,
        defense: combatNpcFromWorld.combat_stats.defense + combatNpcEquipDEF,
        currentMp: activeCombatNpc.current_mp ?? combatNpcFromWorld.combat_stats.max_mp ?? undefined,
      }
      // Reload abilities for combat NPC
      npcAbilities.length = 0
      const { data: combatAbilityRows } = await supabase
        .from('npc_abilities')
        .select('abilities(name, ability_stats)')
        .eq('npc_id', combatNpcFromWorld.id)
      for (const row of combatAbilityRows ?? []) {
        const ability = (row as { abilities?: { name?: string; ability_stats?: Record<string, unknown> } | null }).abilities
        if (ability?.name && ability.ability_stats) {
          npcAbilities.push({
            name: ability.name,
            damage: Number(ability.ability_stats.damage ?? 0),
            mp_cost: Number(ability.ability_stats.mp_cost ?? 0),
            hp_restore: Number(ability.ability_stats.hp_restore ?? 0),
          })
        }
      }
    }
    console.log(`[Workflow] ⚔️ 战斗模式(持续): DB in_combat=true, NPC=${combatNpcName} HP=${npcCurrentHp}/${npcMaxHp}`)
    // Emit combat_info with DB data for correct NPC
    onMeta?.({
      type: 'combat_info',
      data: {
        npcId: activeCombatNpc.npc_id,
        npcName: combatNpcName,
        hp: activeCombatNpc.current_hp,
        maxHp: activeCombatNpc.max_hp,
        mp: activeCombatNpc.current_mp ?? 0,
        maxMp: combatNpcFromWorld?.combat_stats?.max_mp ?? 0,
        attack: targetNpcCombatStats?.attack ?? combatNpcFromWorld?.combat_stats?.attack ?? 0,
        defense: targetNpcCombatStats?.defense ?? combatNpcFromWorld?.combat_stats?.defense ?? 0,
        abilities: npcAbilities.map(a => ({ name: a.name, damage: a.damage, mpCost: a.mp_cost })),
        equipment: npcEquipmentDisplay,
      },
    })
  } else if (targetNpc?.combat_stats?.is_hostile && targetNpcCombatStats &&
             playerExplicitlyNamedTarget &&
             (effectiveScenarioEvent.diceType === 'COMBAT' ||
              intent.intent === 'COMBAT' ||
              intent.intent === 'SPELL_CAST'
             )) {
    // Path 2: First combat encounter — hostile NPC + player explicitly named target + aggressive action
    // Node 11 will set in_combat=true when it creates the session_npc_stats record
    inCombat = true
    isFirstCombatEncounter = true
    combatNpcId = targetNpc.id ?? null
    combatNpcName = targetNpc.name
    console.log(`[Workflow] ⚔️ 战斗模式(首次): NPC=${combatNpcName} HP=${npcCurrentHp}/${npcMaxHp}`)
    // Emit combat_info with full NPC data from RAG
    onMeta?.({
      type: 'combat_info',
      data: {
        npcId: targetNpc.id,
        npcName: targetNpc.name,
        hp: npcCurrentHp,
        maxHp: npcMaxHp,
        mp: targetNpcCombatStats.currentMp ?? 0,
        maxMp: targetNpc.combat_stats?.max_mp ?? 0,
        attack: targetNpcCombatStats.attack,
        defense: targetNpcCombatStats.defense,
        abilities: npcAbilities.map(a => ({ name: a.name, damage: a.damage, mpCost: a.mp_cost })),
        equipment: npcEquipmentDisplay,
      },
    })
    // Emit combat_start banner (persisted in chat)
    onMeta?.({
      type: 'combat_start',
      data: { npcName: combatNpcName },
    })
  } else if (targetNpc && targetNpcCombatStats && !targetNpc.combat_stats?.is_hostile &&
             playerExplicitlyNamedTarget &&
             (intent.intent === 'COMBAT' || intent.intent === 'SPELL_CAST')) {
    // Path 3: Attacking a non-hostile NPC — track aggression, flip hostile after 3 consecutive attempts
    const npcNameLower = targetNpc.name.toLowerCase()
    let consecutiveAggressions = 0
    try {
      const { data: recentEvents } = await supabase
        .from('session_events')
        .select('intent_type, mentioned_entities')
        .eq('session_id', sid)
        .order('created_at', { ascending: false })
        .limit(5)
      for (const event of recentEvents ?? []) {
        const intentType = event.intent_type as string | null
        const entities = (event.mentioned_entities as string[] | null) ?? []
        if ((intentType === 'COMBAT' || intentType === 'SPELL_CAST') &&
            entities.some(e => e.toLowerCase().includes(npcNameLower) || npcNameLower.includes(e.toLowerCase()))) {
          consecutiveAggressions++
        } else {
          break // only count consecutive
        }
      }
    } catch { /* session_events may not exist */ }

    if (consecutiveAggressions >= 2) {
      // 3rd attack (2 previous + current) → NPC becomes hostile → start combat
      inCombat = true
      isFirstCombatEncounter = true
      combatNpcId = targetNpc.id ?? null
      combatNpcName = targetNpc.name
      console.log(`[Workflow] ⚔️ 战斗模式(激怒): 连续${consecutiveAggressions + 1}次攻击非敌对NPC「${combatNpcName}」→ 被迫开战`)
      onMeta?.({
        type: 'combat_info',
        data: {
          npcId: targetNpc.id,
          npcName: targetNpc.name,
          hp: npcCurrentHp,
          maxHp: npcMaxHp,
          mp: targetNpcCombatStats.currentMp ?? 0,
          maxMp: targetNpc.combat_stats?.max_mp ?? 0,
          attack: targetNpcCombatStats.attack,
          defense: targetNpcCombatStats.defense,
          abilities: npcAbilities.map(a => ({ name: a.name, damage: a.damage, mpCost: a.mp_cost })),
          equipment: npcEquipmentDisplay,
        },
      })
      onMeta?.({
        type: 'combat_start',
        data: { npcName: combatNpcName },
      })
    } else {
      console.log(`[Workflow] ⚠️ 攻击非敌对NPC「${targetNpc.name}」(${consecutiveAggressions + 1}/3) — 未开战`)
    }
  }

  // ── NODE 6C: NPC Combat Strategy Agent (LLM, optional) ─────────────────
  let chosenNpcAbility: import('./nodes/6-outcome-synthesizer').NpcAbilityForCombat | null = null
  if (targetNpcCombatStats && npcAbilities.length > 0 && (intent.intent === 'COMBAT' || intent.intent === 'SPELL_CAST' || inCombat)) {
    const npcStrategy = await selectNpcCombatStrategy({
      npcName: targetNpc?.name ?? 'NPC',
      npcHp: npcCurrentHp,
      npcMaxHp: npcMaxHp,
      npcMp: targetNpcCombatStats.currentMp ?? 0,
      npcMaxMp: targetNpc?.combat_stats?.max_mp ?? 0,
      npcAttack: targetNpcCombatStats.attack,
      npcDefense: targetNpcCombatStats.defense,
      abilities: npcAbilities,
      playerHp: effectivePlayerState.hp,
      playerMaxHp: effectivePlayerState.maxHp,
      playerAttack: playerTotalATK,
      playerDefense: playerTotalDEF,
      recentContext: msg,
      openai,
    }).catch((err: unknown) => {
      console.error('[Workflow · Node 6C] NPC策略Agent失败，跳过:', err)
      return null
    })
    chosenNpcAbility = npcStrategy?.chosenAbility ?? null
  }

  // ── NODE 6 Pre: Ability damage lookup for SPELL_CAST ────────────────────
  // When player casts a spell, look up the ability's damage from abilities table.
  // Spell damage formula: ability_damage directly (bypasses physical DEF).
  // Note: targetEntity may be the NPC target (e.g. "幻影刺客"), not the spell name.
  // Try each candidate from mentionedEntities + targetEntity until one matches an ability.
  let playerAbilityDamage: number | undefined
  let playerAbilityMpCost: number | undefined
  if (intent.intent === 'SPELL_CAST') {
    const candidates = [...intent.mentionedEntities, ...(intent.targetEntity ? [intent.targetEntity] : [])]
    for (const candidate of candidates) {
      if (!candidate) continue
      const { data: abilityRow } = await supabase
        .from('abilities')
        .select('ability_stats')
        .eq('world_id', worldId)
        .ilike('name', candidate)
        .maybeSingle()
      if (abilityRow?.ability_stats) {
        const stats = abilityRow.ability_stats as Record<string, unknown>
        playerAbilityDamage = Number(stats.damage ?? 0)
        playerAbilityMpCost = Number(stats.mp_cost ?? 0)
        console.log(`[Workflow · Ability] 技能「${candidate}」damage=${playerAbilityDamage} mp_cost=${playerAbilityMpCost}`)
        break
      }
    }
  }

  // ── NODE 6 Pre: Item stats lookup for ITEM_USE (hp_restore/mp_restore) ──
  let usedItemStats: { hpRestore?: number; mpRestore?: number } | undefined
  if (intent.intent === 'ITEM_USE') {
    const itemName = intent.targetEntity ?? intent.mentionedEntities[0]
    console.log(`[Workflow · ItemUse] targetEntity=${intent.targetEntity ?? '(none)'} mentionedEntities=[${intent.mentionedEntities.join(', ')}] resolved itemName=${itemName ?? '(none)'}`)
    if (itemName) {
      const normalize = (s: string) => s.replace(/[「」『』【】\[\]()（）]/g, '').replace(/\s+/g, '').toLowerCase()
      // Find the item in player inventory
      const invItem = effectivePlayerState.inventory.find(inv =>
        normalize(inv.itemName) === normalize(itemName)
      )
      console.log(`[Workflow · ItemUse] invItem=${invItem ? `「${invItem.itemName}」itemId=${invItem.itemId ?? 'null'}` : '(not found in inventory)'}`)

      // Look up item_stats: prefer FK lookup, fallback to name-based search
      let itemStats: Record<string, unknown> | null = null
      if (invItem?.itemId) {
        const { data: catalogItem } = await supabase
          .from('items')
          .select('item_stats')
          .eq('id', invItem.itemId)
          .maybeSingle()
        itemStats = (catalogItem?.item_stats as Record<string, unknown>) ?? null
      }
      // Fallback: if itemId is null (item added without catalog FK), search catalog by name + world
      if (!itemStats && invItem) {
        const { data: catalogByName } = await supabase
          .from('items')
          .select('item_stats')
          .eq('world_id', worldId)
          .ilike('name', itemName)
          .limit(1)
          .maybeSingle()
        if (catalogByName?.item_stats) {
          itemStats = catalogByName.item_stats as Record<string, unknown>
          console.log(`[Workflow · ItemUse] 通过名称匹配找到 catalog item_stats`)
        }
      }

      if (itemStats) {
        const hpRestore = typeof itemStats.hp_restore === 'number' ? itemStats.hp_restore : undefined
        const mpRestore = typeof itemStats.mp_restore === 'number' ? itemStats.mp_restore : undefined
        console.log(`[Workflow · ItemUse] item_stats keys=[${Object.keys(itemStats).join(',')}] hp_restore=${hpRestore ?? 'undefined'} mp_restore=${mpRestore ?? 'undefined'}`)
        if (hpRestore || mpRestore) {
          usedItemStats = { hpRestore, mpRestore }
          console.log(`[Workflow · ItemUse] ✓ 物品「${itemName}」hp_restore=${hpRestore ?? 0} mp_restore=${mpRestore ?? 0}`)
        }
      } else {
        console.log(`[Workflow · ItemUse] ✗ 未找到 item_stats (invItem=${!!invItem}, itemId=${invItem?.itemId ?? 'null'})`)
      }
    }
  }

  // ── MP Precondition Check ───────────────────────────────────────────────
  // Block SPELL_CAST if the player doesn't have enough MP for the ability.
  // Must run after ability stats lookup (which resolves mp_cost) but before synthesizer.
  let effectivePrecondition = precondition
  if (
    precondition.canProceed &&
    intent.intent === 'SPELL_CAST' &&
    playerAbilityMpCost && playerAbilityMpCost > 0 &&
    effectivePlayerState.mp < playerAbilityMpCost
  ) {
    const abilityName = intent.targetEntity ?? intent.mentionedEntities[0] ?? '技能'
    effectivePrecondition = {
      canProceed: false,
      result: 'FAILED',
      failReason: `MP不足，无法施放「${abilityName}」（需要${playerAbilityMpCost}MP，当前${effectivePlayerState.mp}MP）`,
    }
    console.log(`[Workflow · MP] ✗ MP不足: 需要${playerAbilityMpCost}, 当前${effectivePlayerState.mp}`)
  }

  // ── NODE 6: Outcome Synthesizer (pure) ──────────────────────────────────
  const outcomeSynthesis = synthesizeOutcome({
    intent,
    precondition: effectivePrecondition,
    dice,
    playerState: effectivePlayerState,
    scenarioEvent: effectiveScenarioEvent,
    npcCombatStats: targetNpcCombatStats,
    npcAbilities,
    chosenNpcAbility,
    playerTotalATK,
    playerTotalDEF,
    playerAbilityDamage,
    playerAbilityMpCost,
    inCombat,
    usedItemStats,
  })

  onMeta?.({
    type: 'outcome',
    data: { outcome: outcomeSynthesis.outcome, effects: outcomeSynthesis.mechanicalEffects.length },
  })

  // ── NODE 6B: NPC Action Agent ────────────────────────────────────────────
  // Use intent-aware NPCs when available; fall back to base NPCs.
  const relevantNPCs = intentEntities?.npcs ?? baseData.npcs
  const npcActions = await generateNPCActions({
    npcs: relevantNPCs,
    npcMemories: npcMemories ?? EMPTY_NPC_MEMORIES,
    playerMessage: msg,
    outcomeSynthesis,
    storyState,
    openai,
  }).catch((err: unknown) => {
    console.error('[Workflow · Node 6B] NPC行动生成失败，使用空数组:', err)
    return []
  })

  // ── DEATH PRE-DETECTION ─────────────────────────────────────────────────
  // Calculate projected HP from MechanicalEffect[] BEFORE prompt construction
  // so the ending_bad script can be injected into the current turn's LLM prompt.
  const preHpDeltas = outcomeSynthesis.mechanicalEffects
    .filter(e => e.type === 'HP_DELTA')
    .reduce((sum, e) => sum + (e.delta ?? 0), 0)
  const preProjectedHp = effectivePlayerState.hp + preHpDeltas
  const willDie = effectivePlayerState.hp > 0 && preProjectedHp <= 0

  let deathEndingNode: import('./nodes/3e-story-state-loader').StoryNodeSummary | null = null
  if (willDie) {
    console.log(`[Workflow] ☠️ 提前死亡检测: HP ${effectivePlayerState.hp} + (${preHpDeltas}) = ${preProjectedHp}，加载 ending_bad 台本`)
    const { data: endingBad } = await supabase
      .from('story_nodes')
      .select('id, name, description, node_type, interactive_hints, completion_trigger, is_start_node, ending_script')
      .eq('world_id', worldId)
      .eq('node_type', 'ending_bad')
      .limit(1)
      .maybeSingle()
    if (endingBad) {
      deathEndingNode = endingBad as import('./nodes/3e-story-state-loader').StoryNodeSummary
    }
  }

  // ── NPC DEATH PRE-DETECTION ────────────────────────────────────────────
  const preNpcHpDeltas = outcomeSynthesis.mechanicalEffects
    .filter(e => e.type === 'NPC_HP_DELTA')
    .reduce((sum, e) => sum + (e.delta ?? 0), 0)
  const projectedNpcHp = npcCurrentHp + preNpcHpDeltas
  const npcWillDie = inCombat && npcCurrentHp > 0 && projectedNpcHp <= 0

  // ── Combat loot query (droppable NPC equipment) ─────────────────────────
  const combatLootItems: CombatLootItem[] = []
  if (npcWillDie && combatNpcId) {
    try {
      const { data: drops } = await supabase
        .from('npc_equipment')
        .select('item_name, items(name, description, item_stats)')
        .eq('npc_id', combatNpcId)
        .eq('droppable', true)

      for (const row of drops ?? []) {
        const item = (row as Record<string, unknown>).items as { name: string; description: string; item_stats: Record<string, unknown> | null } | null
        if (item) {
          combatLootItems.push({
            name: item.name,
            description: item.description,
            item_stats: item.item_stats,
          })
        }
      }

      if (combatLootItems.length > 0) {
        console.log(`[Workflow · CombatLoot] NPC击败，${combatLootItems.length} 件可掉落装备: ${combatLootItems.map(i => i.name).join(', ')}`)
      }
    } catch (err) {
      console.warn('[Workflow · CombatLoot] 战斗掉落查询失败，跳过:', err)
    }
  }

  // ── NODE 7: Context Assembly ─────────────────────────────────────────────
  // Use intent-aware entities when available; fall back to base entities.
  const mergedData = intentEntities
    ? {
        ...baseData,
        items:         intentEntities.items,
        locations:     intentEntities.locations,
        abilities:     intentEntities.abilities,
        organizations: intentEntities.organizations,
        taxonomies:    intentEntities.taxonomies,
        rules:         intentEntities.rules,
        npcs:          intentEntities.npcs,
      }
    : baseData

  const contextSections = await assembleContext({
    ...mergedData,
    outcomeSynthesis,
    diceResolution: dice,
    scenarioEvent: effectiveScenarioEvent,
    recentMilestones,
    storyState,
    npcMemories: npcMemories ?? EMPTY_NPC_MEMORIES,
    npcActions,
    equippedItems: equippedItemDetails,
    playerTotalATK,
    playerTotalDEF,
    locationBoundItems,
    allLocationItemNames,
    combatLootItems,
    currentLocationId,
    currentLocationName,
    unlockedNodeIds,
  })

  // ── NODE 8: Prompt Construction ──────────────────────────────────────────
  // Detect active ending node so prompt can inject the conclusive ending directive.
  // deathEndingNode (from pre-detection) takes priority over storyState endings.
  const storyEndingNode = (storyState?.activeNodes ?? []).find(n =>
    n.node_type === 'ending_good' || n.node_type === 'ending_bad'
  ) ?? null
  const activeEndingNode = deathEndingNode ?? storyEndingNode

  // Build combat mode directive when in active combat
  // Uses combatNpcName which works even when RAG missed the hostile NPC (fallback path)
  const combatDirective = inCombat ? buildCombatModeDirective(combatNpcName) : undefined

  const { userPrompt } = await constructPrompt({
    contextSections,
    playerMessage: msg,
    activeEndingNode,
    combatModeDirective: combatDirective,
  })

  // ── NODE 9: Streaming Narrative Generator ────────────────────────────────
  onMeta?.({ type: 'status', data: { message: '编织故事叙事...' } })
  let { dmResponse } = await generateResponse({ userPrompt, openai, onChunk })

  // ── COMBAT SUMMARY (programmatic, appended after LLM text) ─────────────
  if (inCombat) {
    const effects = outcomeSynthesis.mechanicalEffects
    const playerHpDelta = effects.filter(e => e.type === 'HP_DELTA').reduce((s, e) => s + (e.delta ?? 0), 0)
    const playerMpDelta = effects.filter(e => e.type === 'MP_DELTA').reduce((s, e) => s + (e.delta ?? 0), 0)
    const npcHpDelta = effects.filter(e => e.type === 'NPC_HP_DELTA').reduce((s, e) => s + (e.delta ?? 0), 0)
    const npcMpDelta = effects.filter(e => e.type === 'NPC_MP_DELTA').reduce((s, e) => s + (e.delta ?? 0), 0)

    const pName = effectivePlayerState.playerName || '玩家'
    const nName = targetNpc?.name ?? 'NPC'
    const newPHp = Math.max(0, Math.min(effectivePlayerState.maxHp, effectivePlayerState.hp + playerHpDelta))
    const newPMp = Math.max(0, Math.min(effectivePlayerState.maxMp, effectivePlayerState.mp + playerMpDelta))
    const newNHp = Math.max(0, Math.min(npcMaxHp, npcCurrentHp + npcHpDelta))
    const npcMp = targetNpcCombatStats?.currentMp ?? 0
    const npcMaxMpVal = targetNpc?.combat_stats?.max_mp ?? 0
    const newNMp = Math.max(0, Math.min(npcMaxMpVal, npcMp + npcMpDelta))

    // ── Build clear action descriptions from NPC/player perspective ──
    const outcomeType = outcomeSynthesis.outcome
    const playerHitNpc = effects.some(e => e.type === 'NPC_HP_DELTA' && (e.delta ?? 0) < 0)
    const npcHitPlayer = effects.some(e => e.type === 'HP_DELTA' && (e.delta ?? 0) < 0)
    const npcHealedSelf = effects.find(e => e.type === 'NPC_HP_DELTA' && (e.delta ?? 0) > 0)
    const npcAbilityName = chosenNpcAbility?.name ?? null

    // Player action text (what they did TO the NPC)
    let playerActionText: string
    if (playerHitNpc) {
      const dmgToNpc = Math.abs(npcHpDelta)
      const critText = outcomeType === 'CRITICAL_SUCCESS' ? '（暴击！）' : ''
      playerActionText = `对${nName}造成${dmgToNpc}点伤害${critText}`
    } else if (!effectiveScenarioEvent.triggered) {
      playerActionText = '未进行战斗行动（浪费回合）'
    } else if (outcomeType === 'FAILURE' || outcomeType === 'CRITICAL_FAILURE') {
      playerActionText = '攻击未命中'
    } else if (outcomeType === 'PARTIAL') {
      playerActionText = '勉强防御，未能反击'
    } else {
      playerActionText = '发动行动'
    }

    // NPC action text (what NPC did TO the player)
    let npcActionText: string
    if (npcHitPlayer) {
      const dmgToPlayer = Math.abs(playerHpDelta)
      const abilityText = npcAbilityName ? `使用「${npcAbilityName}」` : '发动攻击'
      npcActionText = `${abilityText}，对${pName}造成${dmgToPlayer}点伤害`
    } else if (npcHealedSelf) {
      const healAmt = npcHealedSelf.delta ?? 0
      npcActionText = `使用「${npcAbilityName ?? '治疗'}」恢复${healAmt}HP`
    } else if (outcomeType === 'SUCCESS' || outcomeType === 'CRITICAL_SUCCESS') {
      npcActionText = '攻击被闪避'
    } else {
      npcActionText = '按兵不动'
    }

    const lines: string[] = ['\n---', '⚔ 本回合战况', '']
    // Player block
    lines.push(`▸ ${pName}`)
    lines.push(`  行动：${playerActionText}`)
    lines.push(`  HP ${effectivePlayerState.hp}/${effectivePlayerState.maxHp} → ${newPHp}/${effectivePlayerState.maxHp} | MP ${effectivePlayerState.mp}/${effectivePlayerState.maxMp} → ${newPMp}/${effectivePlayerState.maxMp}`)
    lines.push('')
    // NPC block
    lines.push(`▸ ${nName}`)
    lines.push(`  行动：${npcActionText}`)
    lines.push(`  HP ${npcCurrentHp}/${npcMaxHp} → ${newNHp}/${npcMaxHp} | MP ${npcMp}/${npcMaxMpVal} → ${newNMp}/${npcMaxMpVal}`)
    lines.push('---')

    const summary = lines.join('\n')
    onChunk?.(summary)
    dmResponse += summary
  }

  // ── DEATH DETECTION ──────────────────────────────────────────────────────
  // Two cases:
  //   1. Cross-turn: HP was set to 0 by previous turn's Node 11 but death
  //      was never emitted (e.g. no HP_DELTA on the killing turn).
  //   2. Same-turn: This turn's COMBAT damage takes HP from >0 to <=0.
  const hpDeltaTotal = outcomeSynthesis.mechanicalEffects
    .filter(e => e.type === 'HP_DELTA')
    .reduce((sum, e) => sum + (e.delta ?? 0), 0)
  const projectedHp = effectivePlayerState.hp + hpDeltaTotal
  const playerExists = !!effectivePlayerState.playerId
  const alreadyDead = playerExists && effectivePlayerState.hp <= 0
  const newlyDead = effectivePlayerState.hp > 0 && projectedHp <= 0
  const isDead = alreadyDead || newlyDead

  if (isDead) {
    console.log(
      `[Workflow] ☠️ 检测到死亡: HP ${effectivePlayerState.hp} + (${hpDeltaTotal}) = ${projectedHp}` +
      (alreadyDead ? ' (跨回合，HP已为0)' : ' (当回合击杀)')
    )
    onMeta?.({
      type: 'game_over',
      data: {
        reason: 'death',
        finalHp: alreadyDead ? effectivePlayerState.hp : projectedHp,
        playerName: effectivePlayerState.playerName,
      },
    })
  }

  // ── ENDING DETECTION ────────────────────────────────────────────────────
  // Check if any currently active story node is an ending node.
  // This fires when Node 17 activated an ending node in a previous turn.
  // When detected: emit game_complete AND mark the ending node as completed in DB.
  if (!isDead && activeEndingNode) {
    console.log(
      `[Workflow] 🏁 检测到故事结局: "${activeEndingNode.name}" (${activeEndingNode.node_type})`
    )
    onMeta?.({
      type: 'game_complete',
      data: {
        endingType: activeEndingNode.node_type,
        endingName: activeEndingNode.name,
        playerName: effectivePlayerState.playerName,
      },
    })
    // Clean up combat state on story ending
    if (inCombat || combatNpcId) {
      onMeta?.({ type: 'combat_end', data: { reason: 'story_complete' } })
    }
    // Mark the ending node as completed + clean up all NPC combat states (fire-and-forget)
    void (async () => {
      try {
        await Promise.all([
          supabase
            .from('session_story_state')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('session_id', sid)
            .eq('node_id', activeEndingNode.id),
          // Force all NPCs out of combat on story ending
          supabase
            .from('session_npc_stats')
            .update({ in_combat: false })
            .eq('session_id', sid),
          // Force-kill the combat NPC if story ending triggered during a climax fight
          ...(combatNpcId ? [
            supabase
              .from('session_npc_stats')
              .update({ current_hp: 0, is_alive: false, in_combat: false })
              .eq('session_id', sid)
              .eq('npc_id', combatNpcId),
          ] : []),
        ])
        console.log(`[Workflow] 结局节点已标记完成: ${activeEndingNode.name}`)
      } catch (err) {
        console.error('[Workflow] 标记结局节点失败:', err)
      }
    })()
  }

  // ── NODE 10: Output Persistence ──────────────────────────────────────────
  const output = await persistOutput({ sessionId: sid, dmResponse, supabase })

  // ── NODES 11–19: State updates (awaited, with SSE progress) ─────────────
  // All state updates are awaited so the SSE 'done' event fires only after
  // everything is persisted. Frontend can then do a single refresh.
  try {
    onMeta?.({ type: 'status', data: { message: '更新游戏状态...' } })

    // Phase 1: All independent state updates in parallel
    await Promise.all([
      applyHPMPChanges({ sessionId: sid, effects: outcomeSynthesis.mechanicalEffects, supabase, combatNpcId }),
      applyInventoryChanges({ sessionId: sid, effects: outcomeSynthesis.mechanicalEffects, supabase }),
      applyStatusEffects({ sessionId: sid, effects: outcomeSynthesis.mechanicalEffects, supabase }),
      applyAttributeGains({
        sessionId: sid,
        playerId: effectivePlayerState.playerId ?? null,
        effects: outcomeSynthesis.mechanicalEffects,
        supabase,
      }),
      writeEventLog({
        sessionId: sid,
        playerMessage: msg,
        intent,
        dice,
        outcome: outcomeSynthesis,
        appliedEffects: outcomeSynthesis.mechanicalEffects,
        dmResponse,
        turnStartedAt,
        diceType: effectiveScenarioEvent.triggered ? effectiveScenarioEvent.diceType : undefined,
        locationId: currentLocationId,
        supabase,
      }),
      detectMilestone({
        sessionId: sid,
        playerId: effectivePlayerState.playerId ?? null,
        playerMessage: msg,
        dmResponse,
        intent,
        outcome: outcomeSynthesis,
        supabase,
        openai,
      }),
      checkStoryNodeCompletion({
        sessionId: sid,
        playerMessage: msg,
        // Append mechanical NPC death fact so LLM checker can confirm combat victory
        dmResponse: npcWillDie && combatNpcName
          ? dmResponse + `\n\n【机械系统确认：${combatNpcName}的HP已降至0，已被击败。】`
          : dmResponse,
        activeNodes: storyState?.activeNodes ?? [],
        currentLocationName,
        supabase,
        openai,
      }),
      ...(isDead ? [activateDeathEnding({ sessionId: sid, worldId, supabase })] : []),
      updateNPCMemories({
        sessionId: sid,
        npcs: relevantNPCs,
        npcMemories: npcMemories ?? EMPTY_NPC_MEMORIES,
        playerMessage: msg,
        dmResponse,
        openai,
        supabase,
      }),
    ])

    // Re-emit combat_info with UPDATED HP/MP after Node 11 has persisted changes
    if (inCombat && combatNpcId && targetNpc) {
      const { data: updatedNpcStats } = await supabase
        .from('session_npc_stats')
        .select('current_hp, max_hp, current_mp, max_mp')
        .eq('session_id', sid)
        .eq('npc_id', combatNpcId)
        .maybeSingle()
      if (updatedNpcStats) {
        // Build NPC action summary for this turn (what ability NPC used + damage dealt)
        const npcActionForDisplay = chosenNpcAbility ? {
          abilityName: chosenNpcAbility.name,
          damage: chosenNpcAbility.damage,
          mpCost: chosenNpcAbility.mp_cost,
          damageDealt: Math.abs(outcomeSynthesis.mechanicalEffects
            .filter(e => e.type === 'HP_DELTA' && (e.delta ?? 0) < 0)
            .reduce((s, e) => s + (e.delta ?? 0), 0)),
        } : null
        onMeta?.({
          type: 'combat_info',
          data: {
            npcId: combatNpcId,
            npcName: combatNpcName,
            hp: updatedNpcStats.current_hp,
            maxHp: updatedNpcStats.max_hp,
            mp: updatedNpcStats.current_mp ?? 0,
            maxMp: updatedNpcStats.max_mp ?? targetNpc.combat_stats?.max_mp ?? 0,
            attack: targetNpcCombatStats?.attack ?? targetNpc.combat_stats?.attack ?? 0,
            defense: targetNpcCombatStats?.defense ?? targetNpc.combat_stats?.defense ?? 0,
            abilities: npcAbilities.map(a => ({ name: a.name, damage: a.damage, mpCost: a.mp_cost })),
            equipment: npcEquipmentDisplay,
            npcAction: npcActionForDisplay,
          },
        })
      }
    }

    // Emit combat_victory + combat_end if NPC died this turn (after HP has been persisted)
    if (npcWillDie && targetNpc) {
      onMeta?.({
        type: 'combat_victory',
        data: { npcName: combatNpcName },
      })
      onMeta?.({
        type: 'combat_end',
        data: { npcId: targetNpc.id, reason: 'npc_defeated' },
      })
    }

    onMeta?.({ type: 'status', data: { message: '同步叙事状态...' } })

    // Phase 2: Node 7 runs AFTER Node 11 (race condition guard for dynamic_fields)
    const hpDeltaAppliedByNode11 = outcomeSynthesis.mechanicalEffects.some(e => e.type === 'HP_DELTA')
    await analyzeDynamicFieldUpdates({ sessionId: sid, dmResponse, playerMessage: msg, openai, supabase, hpDeltaAppliedByNode11 })

    // Phase 3: Node 19 — detect items/abilities from narrative and sync to inventory
    await syncNarrativeState({ sessionId: sid, worldId, playerMessage: msg, dmResponse, openai, supabase })

    // Phase 4: Node 19B — LLM-parsed equip/unequip from player message
    // Runs AFTER Node 19 so narrative-gained items are already in inventory
    // Pass inventory item names so LLM can expand batch requests like "装备所有"
    const equipInventoryNames = effectivePlayerState.inventory
      .filter(inv => inv.slotType !== 'ability')
      .map(inv => inv.itemName)
    const equipActions = await parseEquipCommands(msg, openai, equipInventoryNames)
    if (equipActions.length > 0) {
      await executeEquipActions(equipActions, sid, supabase)
    }

    // Phase 5: LLM-based location change detection (fallback when regex missed)
    // Only runs if: (a) regex didn't move, (b) there are other locations available, (c) NOT in combat
    if (!preMovedByRegex && availableLocations.length > 0 && currentLocationName && !inCombat) {
      try {
        const locChoices = availableLocations.map(l => l.name).join('、')
        const locCompletion = await openai.chat.completions.create({
          model: MODEL_FAST,
          messages: [{
            role: 'user',
            content: `玩家说："${msg}"\nDM回应：${dmResponse.slice(0, 400)}\n\n当前位置：${currentLocationName}\n可用目的地：${locChoices}\n\n问题：根据玩家行动和DM叙述，玩家是否**明确**移动到了新位置？\n注意：仅当DM叙述明确描述玩家到达/进入了某个新地点时才算移动。战斗、对话、使用物品等不算移动。如果DM只是提到某个地点的名字但玩家没有实际前往，不算移动。\n只回答目的地名称（必须从可用目的地中选），或回答"无"表示没有移动。只输出名称或"无"，不要解释。`,
          }],
          max_completion_tokens: 30,
        })
        const llmAnswer = locCompletion.choices[0]?.message?.content?.trim() ?? ''
        if (llmAnswer && llmAnswer !== '无') {
          const matchedLoc = availableLocations.find(l => l.name === llmAnswer || l.name.includes(llmAnswer) || llmAnswer.includes(l.name))
          if (matchedLoc) {
            await supabase.from('sessions').update({ current_location_id: matchedLoc.id }).eq('id', sid)
            currentLocationId = matchedLoc.id
            currentLocationName = matchedLoc.name
            console.log(`[Workflow · Location] LLM判定玩家移动 → ${matchedLoc.name} (${matchedLoc.id})`)
          }
        } else {
          console.log(`[Workflow · Location] LLM判定：未移动`)
        }
      } catch (locErr) {
        console.error('[Workflow · Location] LLM位置判定失败（非致命）:', locErr)
      }
    }

    onMeta?.({ type: 'status', data: { message: '状态更新完成' } })
  } catch (err) {
    console.error('[Workflow] 状态更新出错:', err)
  }

  return output
}
