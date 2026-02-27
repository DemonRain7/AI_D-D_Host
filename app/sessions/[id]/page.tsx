'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AppLayout } from '@/components/layout/app-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Send, ChevronDown, ChevronUp, Skull, Map, Trophy, User, Swords, Sparkles, Package, Info, Heart, Zap, Shield, HelpCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Database } from '@/lib/database.types'

type Session = Database['public']['Tables']['sessions']['Row']
type Player = Database['public']['Tables']['players']['Row']
type Message = Database['public']['Tables']['session_messages']['Row']
type PlayerField = Database['public']['Tables']['world_player_fields']['Row']

// Chinese labels for the 5 custom dice attributes
const CUSTOM_ATTR_LABELS: Record<string, string> = {
  combat: '战斗',
  persuasion: '游说',
  chaos: '混沌',
  charm: '魅力',
  wit: '才智',
}

// Chinese labels for story node types
const NODE_TYPE_LABELS: Record<string, string> = {
  start: '开始',
  objective: '目标',
  encounter: '遭遇',
  ending_good: '好结局',
  ending_bad: '坏结局',
  event: '事件',
  hub: '枢纽',
}

// Dice result data stored as synthetic messages
type DiceData = {
  diceType: string; roll: number; modifier: number; total: number;
  dc: number; critSuccess: boolean; critFail: boolean;
  outcome?: string; narrativeHint?: string;
}

// Combat event data stored as synthetic messages
type CombatEventData = {
  eventType: 'combat_start' | 'combat_victory'
  npcName: string
}

// META quick action buttons — markers sent as message content
const META_BUTTONS = [
  { marker: '__META:CHECK_STATS__',     label: '属性', display: '查看属性' },
  { marker: '__META:CHECK_INVENTORY__', label: '背包', display: '查看背包' },
  { marker: '__META:CHECK_ABILITIES__', label: '技能', display: '查看技能' },
  { marker: '__META:CHECK_EQUIPMENT__', label: '装备', display: '查看装备' },
  { marker: '__META:CHECK_STATUS__',    label: '状态', display: '查看状态' },
]
const META_DISPLAY_MAP: Record<string, string> = Object.fromEntries(
  META_BUTTONS.map(b => [b.marker, b.display])
)

// Pipeline steps mapped to SSE status messages from workflow.ts
const PIPELINE_STEPS = [
  { key: '分析行动意图...', label: '分析意图' },
  { key: '查询玩家信息...', label: '查询信息' },
  { key: '检索世界背景...', label: '检索背景' },
  { key: '编织故事叙事...', label: '编织叙事' },
  { key: '更新游戏状态...', label: '更新状态' },
  { key: '同步叙事状态...', label: '同步叙事' },
  { key: '状态更新完成', label: '完成' },
]

export default function SessionPage() {
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const starterSentRef = useRef(false)
  const initLockRef = useRef(false)  // Prevent concurrent fetchSessionData (React Strict Mode)

  const [session, setSession] = useState<Session | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [playerFields, setPlayerFields] = useState<PlayerField[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [streamingContent, setStreamingContent] = useState<string>('')
  const [streamingStatus, setStreamingStatus] = useState<string>('')
  const [maxPipelineIdx, setMaxPipelineIdx] = useState(-1)  // Monotonically increasing pipeline progress
  const [isStreaming, setIsStreaming] = useState(false)
  // Player panel: collapsed (compact) by default
  const [playerPanelExpanded, setPlayerPanelExpanded] = useState(true)
  // Death / game over
  const [isGameOver, setIsGameOver] = useState(false)
  const [gameOverPlayerName, setGameOverPlayerName] = useState('')
  // Game completion (story ending)
  const [isGameComplete, setIsGameComplete] = useState(false)
  const [gameCompleteData, setGameCompleteData] = useState<{
    endingType: string; endingName: string; playerName: string;
  } | null>(null)
  // Story progress
  const [storyNodes, setStoryNodes] = useState<Array<{
    id: string; name: string; node_type: string; status: string;
  }>>([])
  const [storyPanelOpen, setStoryPanelOpen] = useState(true)
  // Core stats (HP/MP/ATK/DEF) from player_core_stats
  type CoreStats = { current_hp: number; max_hp: number; current_mp: number; max_mp: number; attack: number; defense: number }
  const [coreStatsDisplay, setCoreStatsDisplay] = useState<CoreStats | null>(null)
  // Equipment bonus tracking (from SSE equipment event) — for "base+bonus" display
  const [equipBonus, setEquipBonus] = useState<{ atk: number; def: number }>({ atk: 0, def: 0 })
  // Current location name (from sessions.current_location_id → locations.name)
  const [currentLocationName, setCurrentLocationName] = useState<string | null>(null)
  // Custom attributes (five-dimension dice stats)
  const [customAttrs, setCustomAttrs] = useState<Record<string, number> | null>(null)
  // Inventory & abilities from player_inventory table
  type InventoryRow = {
    id: string; item_name: string; quantity: number; slot_type: string | null; equipped: boolean;
    custom_properties?: Record<string, unknown> | null;
    items?: { description: string; item_stats?: Record<string, unknown> | null } | null;
  }
  const [inventoryItems, setInventoryItems] = useState<InventoryRow[]>([])
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  /** Detect equipment: ONLY use the explicit equipped flag from DB (authoritative source) */
  const isEquipment = (i: InventoryRow): boolean => i.equipped
  // Dice roll display (live during streaming only)
  const [diceResult, setDiceResult] = useState<DiceData | null>(null)
  // Combat NPC info (shown during active combat)
  type CombatNpcInfo = {
    npcId: string; npcName: string;
    hp: number; maxHp: number; mp: number; maxMp: number;
    attack: number; defense: number;
    abilities: Array<{ name: string; damage: number; mpCost: number }>;
    equipment: Array<{ name: string; slot: string }>;
    npcAction?: { abilityName: string; damage: number; mpCost: number; damageDealt: number } | null;
  }
  const [combatNpc, setCombatNpc] = useState<CombatNpcInfo | null>(null)
  const [enemyPanelExpanded, setEnemyPanelExpanded] = useState(false)
  // Combat overlay states (auto-dismiss for start, manual for victory)
  const [combatStartOverlay, setCombatStartOverlay] = useState<string | null>(null) // NPC name
  const [combatVictoryOverlay, setCombatVictoryOverlay] = useState<string | null>(null) // NPC name
  // Overlay dismissed but game still ended (keeps input blocked)
  const [gameOverDismissed, setGameOverDismissed] = useState(false)
  const [gameCompleteDismissed, setGameCompleteDismissed] = useState(false)
  // Character creation gate — must create character before playing
  const [characterCreated, setCharacterCreated] = useState(false)
  // Input blocked when dead, game complete, or character not yet created
  const inputBlocked = isGameOver || isGameComplete || !characterCreated

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchSessionData = useCallback(async () => {
    // Prevent concurrent execution (React Strict Mode fires useEffect twice,
    // causing two async calls to race and insert duplicate starter items)
    if (initLockRef.current) return
    initLockRef.current = true
    try {
      // Fetch session
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', params.id)
        .single()

      if (sessionError) throw sessionError
      setSession(sessionData)

      // Fetch current location name
      const sessRow = sessionData as { current_location_id?: string | null }
      if (sessRow.current_location_id) {
        const { data: locRow } = await supabase
          .from('locations')
          .select('name')
          .eq('id', sessRow.current_location_id)
          .single()
        setCurrentLocationName((locRow as { name: string } | null)?.name ?? null)
      }

      // Fetch world starter text for auto-opening scene.
      // Three-tier fallback: starter → description → generic from world name.
      // Using select('*') avoids column-not-found errors if starter column is missing.
      const { data: worldData } = await supabase
        .from('worlds')
        .select('*')
        .eq('id', sessionData.world_id)
        .single()
      const w = worldData as { starter?: string | null; description?: string | null; name?: string; tone?: string } | null
      let worldStarter: string | null =
        w?.starter?.trim() ||
        w?.description?.trim() ||
        null
      // Last resort: build an opener from world name so game start never fails
      if (!worldStarter && w?.name) {
        worldStarter = `欢迎来到《${w.name}》的世界。${w.tone ? `\n\n这是一个${w.tone}的世界。` : ''}\n\n游戏开始了，你的冒险从这里出发…`
      }

      // Fetch player fields for the world first
      const { data: fieldsData } = await supabase
        .from('world_player_fields')
        .select('*')
        .eq('world_id', sessionData.world_id)
        .order('display_order')

      setPlayerFields(fieldsData?.filter(f => !f.is_hidden) || [])

      // Fetch player (use limit(1) to handle duplicate records from concurrent renders)
      const { data: playerData } = await supabase
        .from('players')
        .select('*')
        .eq('session_id', params.id)
        .order('created_at')
        .limit(1)
        .maybeSingle()

      let resolvedPlayerId: string | null = null
      let isCharacterReady = false
      if (playerData) {
        // Player exists — check if character was already created (has a name)
        if (playerData.name && String(playerData.name).trim()) {
          isCharacterReady = true
        }
        // Backfill any world_player_fields that are missing from existing dynamic_fields
        const dynFields = (playerData.dynamic_fields as Record<string, unknown>) ?? {}
        let needsSync = false
        if (fieldsData && fieldsData.length > 0) {
          for (const field of fieldsData) {
            if (!(field.field_name in dynFields)) {
              needsSync = true
              if (field.field_type === 'number' && field.default_value != null) {
                dynFields[field.field_name] = Number(field.default_value)
              } else {
                dynFields[field.field_name] = field.default_value
              }
            }
          }
        }
        if (needsSync) {
          // Write backfilled fields to DB so backend nodes see them
          await supabase
            .from('players')
            .update({ dynamic_fields: dynFields, updated_at: new Date().toISOString() })
            .eq('id', playerData.id)
          playerData.dynamic_fields = dynFields
          console.log('[Session] 已补全缺失的动态字段:', dynFields)
        }
        resolvedPlayerId = playerData.id
        setPlayer(playerData)
      } else {
        // No player record in DB yet — auto-create one with default dynamic_fields
        // Re-check to prevent duplicate creation from React concurrent renders
        const { data: raceCheck } = await supabase
          .from('players')
          .select('id')
          .eq('session_id', params.id as string)
          .limit(1)
        if (raceCheck && raceCheck.length > 0) {
          // Another render already created the player — use it
          const { data: existingPlayer } = await supabase
            .from('players')
            .select('*')
            .eq('id', raceCheck[0].id)
            .single()
          if (existingPlayer) {
            resolvedPlayerId = existingPlayer.id
            setPlayer(existingPlayer)
          }
        } else {
        const initialDynamicFields: Record<string, unknown> = {}
        if (fieldsData && fieldsData.length > 0) {
          fieldsData.forEach((field) => {
            if (field.field_type === 'number' && field.default_value != null) {
              initialDynamicFields[field.field_name] = Number(field.default_value)
            } else {
              initialDynamicFields[field.field_name] = field.default_value
            }
          })
        }

        const { data: newPlayer, error: createErr } = await supabase
          .from('players')
          .insert({
            session_id: params.id as string,
            name: '',
            appearance: '',
            state: null,
            dynamic_fields: initialDynamicFields,
          })
          .select()
          .single()

        if (createErr) {
          console.error('[Session] 自动创建玩家记录失败:', createErr.message)
          // Fallback to local-only state
          setPlayer({
            id: '',
            session_id: params.id as string,
            name: '',
            appearance: '',
            state: null,
            dynamic_fields: initialDynamicFields,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as Player)
        } else {
          resolvedPlayerId = newPlayer.id
          setPlayer(newPlayer)
          console.log('[Session] 已自动创建玩家记录, dynamic_fields:', initialDynamicFields)

          // Initialize player_core_stats with world defaults (skip if already exists from concurrent render)
          const { data: existingCoreStats } = await supabase
            .from('player_core_stats')
            .select('id')
            .eq('session_id', params.id as string)
            .maybeSingle()
          if (!existingCoreStats) {
            const worldRow = worldData as { player_defaults?: Record<string, number> } | null
            const defaults = worldRow?.player_defaults
            await supabase.from('player_core_stats').insert({
              session_id: params.id as string,
              player_id: newPlayer.id,
              current_hp: defaults?.hp ?? 10,
              max_hp: defaults?.hp ?? 10,
              current_mp: defaults?.mp ?? 0,
              max_mp: defaults?.mp ?? 0,
              attack: defaults?.attack ?? 2,
              defense: defaults?.defense ?? 0,
            }).then(({ error: csErr }) => {
              if (csErr) console.warn('[Session] player_core_stats已存在，跳过')
              else console.log('[Session] 已创建player_core_stats, defaults:', defaults)
            })
          }

          // Starter items are populated later (single idempotent path after inventory fetch)
        }
        } // end race-check else (actual player creation)
      }

      // Fetch custom attributes (five-dimension dice stats)
      const { data: attrData } = await supabase
        .from('player_custom_attributes')
        .select('combat, persuasion, chaos, charm, wit')
        .eq('session_id', params.id as string)
        .maybeSingle()
      if (attrData) {
        setCustomAttrs(attrData as Record<string, number>)
      } else {
        // Auto-create with world defaults (or zeros) so attributes are always visible (ignore duplicate from concurrent render)
        const worldRow = worldData as { initial_custom_attributes?: Record<string, number> } | null
        const ica = worldRow?.initial_custom_attributes
        const defaultAttrs = {
          combat: ica?.combat ?? 0,
          persuasion: ica?.persuasion ?? 0,
          chaos: ica?.chaos ?? 0,
          charm: ica?.charm ?? 0,
          wit: ica?.wit ?? 0,
        }
        const { error: attrErr } = await supabase
          .from('player_custom_attributes')
          .insert({
            session_id: params.id as string,
            player_id: resolvedPlayerId || null,
            ...defaultAttrs,
          })
        if (attrErr && !attrErr.message.includes('duplicate key')) {
          console.error('[Session] 自动创建五维属性失败:', attrErr.message)
        } else if (!attrErr) {
          console.log('[Session] 已自动创建五维属性记录, defaults:', defaultAttrs)
        }
        setCustomAttrs(defaultAttrs)
      }

      // Fetch inventory & abilities (join items table for description)
      let { data: invData } = await supabase
        .from('player_inventory')
        .select('id, item_name, quantity, slot_type, equipped, custom_properties, items(description, item_stats)')
        .eq('session_id', params.id as string)
        .order('created_at')

      // Idempotent starter data population — single path, checks what already exists, inserts only missing items.
      // Safe under concurrent execution: even if called twice, no duplicates because we diff before inserting.
      if (resolvedPlayerId) {
        const existingKeys = new Set(
          (invData ?? []).map((i: { item_name: string; slot_type?: string | null }) => `${i.item_name}::${i.slot_type ?? ''}`)
        )
        const [{ data: sEquip }, { data: sItems }, { data: sAbilities }] = await Promise.all([
          supabase.from('world_starter_equipment').select('item_id, item_name, slot_type').eq('world_id', sessionData.world_id),
          supabase.from('world_starter_items').select('item_id, item_name, quantity').eq('world_id', sessionData.world_id),
          supabase.from('world_starter_abilities').select('ability_id, abilities(name, description)').eq('world_id', sessionData.world_id),
        ])
        const rows: Record<string, unknown>[] = []
        for (const eq of sEquip ?? []) {
          const key = `${(eq as { item_name: string }).item_name}::${(eq as { slot_type: string }).slot_type}`
          if (!existingKeys.has(key)) {
            rows.push({ session_id: params.id, player_id: resolvedPlayerId, item_id: (eq as { item_id: string }).item_id, item_name: (eq as { item_name: string }).item_name, slot_type: (eq as { slot_type: string }).slot_type, equipped: true, quantity: 1 })
          }
        }
        for (const si of sItems ?? []) {
          const key = `${(si as { item_name: string }).item_name}::`
          if (!existingKeys.has(key)) {
            rows.push({ session_id: params.id, player_id: resolvedPlayerId, item_id: (si as { item_id: string }).item_id, item_name: (si as { item_name: string }).item_name, equipped: false, quantity: (si as { quantity: number }).quantity ?? 1 })
          }
        }
        for (const sa of (sAbilities ?? [])) {
          const ab = (sa as { abilities: unknown }).abilities as { name: string; description: string } | null
          const abilityName = ab?.name ?? 'Unknown Ability'
          const key = `${abilityName}::ability`
          if (!existingKeys.has(key)) {
            rows.push({ session_id: params.id, player_id: resolvedPlayerId, item_id: null, item_name: abilityName, slot_type: 'ability', equipped: false, quantity: 1, custom_properties: ab?.description ? { description: ab.description } : null })
          }
        }
        if (rows.length > 0) {
          const { error: popErr } = await supabase.from('player_inventory').insert(rows)
          if (popErr) {
            console.warn('[Session] 初始数据补充失败(可能已存在):', popErr.message)
          } else {
            console.log(`[Session] 已补充${rows.length}条缺失的初始数据`)
            const { data: refreshed } = await supabase
              .from('player_inventory')
              .select('id, item_name, quantity, slot_type, equipped, custom_properties, items(description, item_stats)')
              .eq('session_id', params.id as string)
              .order('created_at')
            invData = refreshed
          }
        }
      }

      setInventoryItems((invData ?? []) as unknown as InventoryRow[])

      // Fetch messages
      const { data: messagesData } = await supabase
        .from('session_messages')
        .select('*')
        .eq('session_id', params.id)
        .order('created_at', { ascending: true })

      setMessages(messagesData || [])

      // Fetch story progress
      await fetchStoryProgress()

      // Detect death/ending on page load + store core stats for display
      {
        const [{ data: coreStats }, { data: latestPlayer }] = await Promise.all([
          supabase.from('player_core_stats').select('current_hp, max_hp, current_mp, max_mp, attack, defense').eq('session_id', params.id).maybeSingle(),
          supabase.from('players').select('name, id').eq('session_id', params.id).order('created_at').limit(1).maybeSingle(),
        ])
        if (coreStats) {
          setCoreStatsDisplay(coreStats as CoreStats)
        } else if (latestPlayer) {
          // Auto-create player_core_stats for existing sessions that don't have one
          const wRow = worldData as { player_defaults?: Record<string, number> } | null
          const pd = wRow?.player_defaults
          const newStats = {
            current_hp: pd?.hp ?? 10, max_hp: pd?.hp ?? 10,
            current_mp: pd?.mp ?? 0, max_mp: pd?.mp ?? 0,
            attack: pd?.attack ?? 2, defense: pd?.defense ?? 0,
          }
          await supabase.from('player_core_stats').insert({
            session_id: params.id as string,
            player_id: latestPlayer.id,
            ...newStats,
          }).then(({ error: csErr }) => {
            if (!csErr) console.log('[Session] 已为现有会话补建player_core_stats')
          })
          setCoreStatsDisplay(newStats as CoreStats)
        }
        const hp = (coreStats?.current_hp as number) ?? 10
        if (hp <= 0) {
          setIsGameOver(true)
          setGameOverPlayerName((latestPlayer?.name as string) || '')
        }
      }
      // Check for active or completed ending nodes (workflow marks ending as 'completed' after emitting game_complete)
      {
        const { data: endingNodes } = await supabase
          .from('session_story_state')
          .select('story_nodes(node_type, name)')
          .eq('session_id', params.id)
          .in('status', ['active', 'completed'])
        if (endingNodes) {
          for (const row of endingNodes as unknown as Array<{ story_nodes: { node_type: string; name: string } | null }>) {
            const nt = row.story_nodes?.node_type
            if (nt === 'ending_good' || nt === 'ending_bad') {
              setIsGameComplete(true)
              setGameCompleteData({
                endingType: nt,
                endingName: row.story_nodes?.name ?? '',
                playerName: (playerData?.name as string) || '',
              })
              break
            }
          }
        }
      }

      // Restore combat state from DB (session_npc_stats.in_combat)
      {
        const { data: activeCombat } = await supabase
          .from('session_npc_stats')
          .select('npc_id, current_hp, max_hp, current_mp, max_mp')
          .eq('session_id', params.id)
          .eq('in_combat', true)
          .eq('is_alive', true)
          .limit(1)
          .maybeSingle()
        if (activeCombat) {
          const [{ data: npcRow }, { data: abilityRows }, { data: equipRows }] = await Promise.all([
            supabase.from('npcs').select('name, combat_stats').eq('id', activeCombat.npc_id).single(),
            supabase.from('npc_abilities').select('abilities(name, ability_stats)').eq('npc_id', activeCombat.npc_id),
            supabase.from('npc_equipment').select('slot_type, items(name, item_stats)').eq('npc_id', activeCombat.npc_id),
          ])
          const cs = (npcRow as { name: string; combat_stats: Record<string, number> } | null)?.combat_stats
          const abilities: CombatNpcInfo['abilities'] = []
          for (const r of abilityRows ?? []) {
            const ab = (r as unknown as { abilities: { name: string; ability_stats?: Record<string, unknown> } | null }).abilities
            if (ab) abilities.push({ name: ab.name, damage: Number(ab.ability_stats?.damage ?? 0), mpCost: Number(ab.ability_stats?.mp_cost ?? 0) })
          }
          const equipment: CombatNpcInfo['equipment'] = []
          let eqATK = 0, eqDEF = 0
          for (const r of equipRows ?? []) {
            const eq = r as { slot_type?: string; items?: { name?: string; item_stats?: Record<string, unknown> } | null }
            if (eq.items?.name) equipment.push({ name: eq.items.name, slot: eq.slot_type ?? '' })
            if (typeof eq.items?.item_stats?.atk_bonus === 'number') eqATK += eq.items.item_stats.atk_bonus
            if (typeof eq.items?.item_stats?.def_bonus === 'number') eqDEF += eq.items.item_stats.def_bonus
          }
          setCombatNpc({
            npcId: activeCombat.npc_id,
            npcName: (npcRow as { name: string } | null)?.name ?? 'NPC',
            hp: activeCombat.current_hp,
            maxHp: activeCombat.max_hp ?? cs?.max_hp ?? 10,
            mp: activeCombat.current_mp ?? 0,
            maxMp: activeCombat.max_mp ?? cs?.max_mp ?? 0,
            attack: (cs?.attack ?? 0) + eqATK,
            defense: (cs?.defense ?? 0) + eqDEF,
            abilities,
            equipment,
          })
          console.log(`[Session] ⚔️ 恢复战斗状态: NPC=${(npcRow as { name: string } | null)?.name} HP=${activeCombat.current_hp}/${activeCombat.max_hp}`)
        }
      }

      // Character creation gate only applies to brand-new sessions (no messages).
      // If there are already messages, the game has started — skip the gate.
      const hasMessages = messagesData && messagesData.length > 0
      setCharacterCreated(isCharacterReady || !!hasMessages)

      // Auto-trigger opening scene only if character is created and no messages yet
      if (isCharacterReady && !hasMessages && !starterSentRef.current) {
        starterSentRef.current = true
        setTimeout(() => triggerGameStart(params.id as string, worldStarter ?? undefined), 300)
      }
    } catch {
      toast.error('Failed to load session')
    } finally {
      setLoading(false)
      initLockRef.current = false
    }
  }, [params.id, supabase])

  const subscribeToMessages = useCallback(() => {
    const channel = supabase
      .channel(`session-${params.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'session_messages',
          filter: `session_id=eq.${params.id}`,
        },
        (payload) => {
          const newMessage = payload.new as Message

          // Only add if we don't already have this message (avoid duplicates from optimistic updates)
          setMessages((prev) => {
            const exists = prev.some(msg =>
              msg.id === newMessage.id ||
              (msg.content === newMessage.content && msg.created_at === newMessage.created_at)
            )

            if (exists) {
              return prev
            }

            return [...prev, newMessage]
          })
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [params.id, supabase])

  // Streams a DM response for the given player message. If isHidden=true the
  // player-side message is NOT inserted into session_messages.
  const streamDMResponse = useCallback(async (sessionId: string, playerMessage: string) => {
    try {
      const response = await fetch('/api/dm-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, playerMessage }),
      })
      if (!response.ok || !response.body) return

      setIsStreaming(true)
      setStreamingContent('')
      setDiceResult(null) // Clear previous dice for live display
      setMaxPipelineIdx(-1) // Reset pipeline progress for new turn

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedText = ''
      let finalMessageId: string | null = null
      let currentDice: DiceData | null = null
      const combatEvents: CombatEventData[] = []

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const payload = JSON.parse(line.slice(6))
              if (payload.type === 'delta') {
                if (!accumulatedText) setStreamingStatus('') // clear status on first text
                accumulatedText += payload.content
                setStreamingContent(accumulatedText)
              } else if (payload.type === 'done') {
                finalMessageId = payload.messageId
              } else if (payload.type === 'meta' && payload.event === 'status') {
                const statusMsg = String(payload.data?.message ?? '')
                setStreamingStatus(statusMsg)
                // Update monotonic pipeline progress (never decrease)
                const idx = PIPELINE_STEPS.findIndex(s => s.key === statusMsg)
                if (idx >= 0) setMaxPipelineIdx(prev => Math.max(prev, idx))
              } else if (payload.type === 'meta' && payload.event === 'dice') {
                currentDice = {
                  diceType: String(payload.data?.diceType ?? ''),
                  roll: Number(payload.data?.roll ?? 0),
                  modifier: Number(payload.data?.modifier ?? 0),
                  total: Number(payload.data?.total ?? 0),
                  dc: Number(payload.data?.dc ?? 0),
                  critSuccess: Boolean(payload.data?.critSuccess),
                  critFail: Boolean(payload.data?.critFail),
                }
                setDiceResult(currentDice) // Live display
              } else if (payload.type === 'meta' && payload.event === 'outcome') {
                if (currentDice) {
                  currentDice = Object.assign({}, currentDice, {
                    outcome: String(payload.data?.outcome ?? ''),
                    narrativeHint: String(payload.data?.narrativeHint ?? ''),
                  })
                  setDiceResult(currentDice) // Live display update
                }
              } else if (payload.type === 'meta' && payload.event === 'equipment') {
                const eqItems = payload.data?.items as Array<{ name: string; slot: string; atk: number; def: number; special: string }> | undefined
                const totalATK = Number(payload.data?.totalATK ?? 0)
                const totalDEF = Number(payload.data?.totalDEF ?? 0)
                const itemNames = eqItems?.map((i: { name: string }) => i.name).join(', ') ?? ''
                // Compute equipment bonus = total - base (base comes from coreStatsDisplay)
                const baseATK = coreStatsDisplay?.attack ?? 2
                const baseDEF = coreStatsDisplay?.defense ?? 0
                setEquipBonus({ atk: totalATK - baseATK, def: totalDEF - baseDEF })
                setStreamingStatus(`装备加成: ATK ${totalATK} / DEF ${totalDEF} [${itemNames}]`)
              } else if (payload.type === 'meta' && payload.event === 'combat_info') {
                setCombatNpc({
                  npcId: String(payload.data?.npcId ?? ''),
                  npcName: String(payload.data?.npcName ?? ''),
                  hp: Number(payload.data?.hp ?? 0),
                  maxHp: Number(payload.data?.maxHp ?? 0),
                  mp: Number(payload.data?.mp ?? 0),
                  maxMp: Number(payload.data?.maxMp ?? 0),
                  attack: Number(payload.data?.attack ?? 0),
                  defense: Number(payload.data?.defense ?? 0),
                  abilities: (payload.data?.abilities as CombatNpcInfo['abilities']) ?? [],
                  equipment: (payload.data?.equipment as CombatNpcInfo['equipment']) ?? [],
                  npcAction: (payload.data?.npcAction as CombatNpcInfo['npcAction']) ?? null,
                })
              } else if (payload.type === 'meta' && payload.event === 'combat_start') {
                const npcName = String(payload.data?.npcName ?? '???')
                combatEvents.push({ eventType: 'combat_start', npcName })
                setCombatStartOverlay(npcName)
                // Auto-dismiss after 2.5 seconds
                setTimeout(() => setCombatStartOverlay(null), 2500)
              } else if (payload.type === 'meta' && payload.event === 'combat_victory') {
                const npcName = String(payload.data?.npcName ?? '???')
                combatEvents.push({ eventType: 'combat_victory', npcName })
                setCombatVictoryOverlay(npcName)
              } else if (payload.type === 'meta' && payload.event === 'combat_end') {
                setCombatNpc(null)
              } else if (payload.type === 'meta' && payload.event === 'game_over') {
                setCombatNpc(null)
                setGameOverPlayerName(String(payload.data?.playerName ?? ''))
                setIsGameOver(true)
              } else if (payload.type === 'meta' && payload.event === 'game_complete') {
                setGameCompleteData({
                  endingType: String(payload.data?.endingType ?? ''),
                  endingName: String(payload.data?.endingName ?? ''),
                  playerName: String(payload.data?.playerName ?? ''),
                })
                setIsGameComplete(true)
              }
            } catch { /* ignore malformed lines */ }
          }
        }
      } finally {
        reader.releaseLock()
      }

      // Persist combat events + dice result + DM message into messages array
      if (accumulatedText) {
        const newEntries: Message[] = []
        // Save combat_start as a synthetic message (persists in chat like dice)
        for (const ce of combatEvents.filter(e => e.eventType === 'combat_start')) {
          newEntries.push({
            id: `combat-start-${Date.now()}`,
            session_id: sessionId,
            author: 'combat_event',
            content: JSON.stringify(ce),
            created_at: new Date().toISOString(),
          } as unknown as Message)
        }
        // Save dice as a synthetic message (persists in chat)
        if (currentDice) {
          newEntries.push({
            id: `dice-${Date.now()}`,
            session_id: sessionId,
            author: 'dice',
            content: JSON.stringify(currentDice),
            created_at: new Date().toISOString(),
          } as unknown as Message)
        }
        newEntries.push({
          id: finalMessageId || `dm-${Date.now()}`,
          session_id: sessionId,
          author: 'dm',
          content: accumulatedText,
          created_at: new Date().toISOString(),
        } as Message)
        // Save combat_victory as a synthetic message after DM response
        for (const ce of combatEvents.filter(e => e.eventType === 'combat_victory')) {
          newEntries.push({
            id: `combat-victory-${Date.now()}`,
            session_id: sessionId,
            author: 'combat_event',
            content: JSON.stringify(ce),
            created_at: new Date().toISOString(),
          } as unknown as Message)
        }
        setMessages(prev => [...prev, ...newEntries])
      }
    } catch (err) {
      console.error('[streamDMResponse] error:', err)
    } finally {
      setStreamingContent('')
      setStreamingStatus('')
      setIsStreaming(false)
      setDiceResult(null) // Clear live display (persisted dice messages remain)
    }
  }, [])

  // Called once when a brand-new session has no messages yet.
  // If staticOpening is provided (world.starter or world.description), inserts it
  // directly as the first DM message — no AI call, instant, no timeout risk.
  // Falls back to AI generation only when no static text is available.
  const triggerGameStart = useCallback(async (sessionId: string, staticOpening?: string) => {
    if (staticOpening?.trim()) {
      const { data } = await supabase
        .from('session_messages')
        .insert({ session_id: sessionId, author: 'dm', content: staticOpening.trim() })
        .select()
        .single()
      if (data) {
        setMessages(prev => [...prev, data as Message])
      }
      return
    }
    // No pre-defined opening — generate one with AI
    await streamDMResponse(sessionId, '__GAME_START__')
  }, [supabase, streamDMResponse])

  const fetchStoryProgress = useCallback(async () => {
    try {
      // Try FK join first (requires FK from session_story_state.node_id → story_nodes.id)
      const { data, error } = await supabase
        .from('session_story_state')
        .select('node_id, status, story_nodes(id, name, node_type)')
        .eq('session_id', params.id)
        .in('status', ['active', 'completed'])

      if (!error && data && data.length > 0) {
        setStoryNodes(data.map((row: Record<string, unknown>) => {
          const node = row.story_nodes as Record<string, unknown> | null
          return {
            id: String(row.node_id),
            name: String(node?.name ?? '未知节点'),
            node_type: String(node?.node_type ?? 'objective'),
            status: String(row.status ?? 'active'),
          }
        }))
        return
      }

      // Fallback: manual join if FK isn't set up
      if (error) {
        console.warn('[fetchStoryProgress] FK join failed, trying manual join:', error.message)
      }
      const { data: stateRows } = await supabase
        .from('session_story_state')
        .select('node_id, status')
        .eq('session_id', params.id)
        .in('status', ['active', 'completed'])

      if (stateRows && stateRows.length > 0) {
        const nodeIds = stateRows.map((r: Record<string, unknown>) => String(r.node_id))
        const { data: nodes } = await supabase
          .from('story_nodes')
          .select('id, name, node_type')
          .in('id', nodeIds)

        const nodeMap: Record<string, { id: string; name: string; node_type: string }> = {}
        for (const n of ((nodes ?? []) as Array<{ id: string; name: string; node_type: string }>)) {
          nodeMap[n.id] = n
        }
        setStoryNodes(stateRows.map((r: Record<string, unknown>) => {
          const nid = String(r.node_id)
          const node = nodeMap[nid]
          return {
            id: nid,
            name: node?.name ?? '未知节点',
            node_type: node?.node_type ?? 'objective',
            status: String(r.status ?? 'active'),
          }
        }))
      }
    } catch (err) {
      console.error('[fetchStoryProgress] Error:', err)
    }
  }, [supabase, params.id])

  const refreshPlayerData = useCallback(async () => {
    const [{ data: playerData }, { data: attrData }, { data: invData }, { data: coreStats }, { data: sessRow }] = await Promise.all([
      supabase.from('players').select('*').eq('session_id', params.id).order('created_at').limit(1).maybeSingle(),
      supabase.from('player_custom_attributes').select('combat, persuasion, chaos, charm, wit').eq('session_id', params.id as string).maybeSingle(),
      supabase.from('player_inventory').select('id, item_name, quantity, slot_type, equipped, custom_properties, items(description, item_stats)').eq('session_id', params.id as string).order('created_at'),
      supabase.from('player_core_stats').select('current_hp, max_hp, current_mp, max_mp, attack, defense').eq('session_id', params.id as string).maybeSingle(),
      supabase.from('sessions').select('current_location_id').eq('id', params.id as string).single(),
    ])

    if (playerData) {
      setPlayer(playerData)
      // Check if HP dropped to 0 — read from player_core_stats
      const hp = (coreStats?.current_hp as number) ?? 10
      if (hp <= 0) {
        setIsGameOver(true)
        setGameOverPlayerName(String(playerData.name ?? ''))
      }
    }
    if (coreStats) {
      setCoreStatsDisplay(coreStats as CoreStats)
    }
    if (attrData) {
      setCustomAttrs(attrData as Record<string, number>)
    }
    // Update current location name (simple two-step: get id, then name)
    const locId = (sessRow as { current_location_id?: string | null } | null)?.current_location_id
    if (locId) {
      const { data: locRow } = await supabase.from('locations').select('name').eq('id', locId).single()
      setCurrentLocationName((locRow as { name: string } | null)?.name ?? null)
    } else {
      setCurrentLocationName(null)
    }
    const typedInv = (invData ?? []) as unknown as InventoryRow[]
    setInventoryItems(typedInv)
    // Compute equipment bonuses from equipped items' item_stats
    let eqAtk = 0, eqDef = 0
    for (const item of typedInv) {
      if (isEquipment(item) && item.items?.item_stats) {
        const s = item.items.item_stats
        if (typeof s.atk_bonus === 'number') eqAtk += s.atk_bonus
        if (typeof s.def_bonus === 'number') eqDef += s.def_bonus
      }
    }
    setEquipBonus({ atk: eqAtk, def: eqDef })
  }, [supabase, params.id])

  useEffect(() => {
    fetchSessionData()
    const unsubscribe = subscribeToMessages()
    return unsubscribe
  }, [fetchSessionData, subscribeToMessages])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSavePlayer = async () => {
    if (!session || !player?.name) {
      toast.error('请填写角色名称')
      return
    }

    try {
      if (player.id && player.id !== '') {
        // Update existing player
        const { error } = await supabase
          .from('players')
          .update({
            name: player.name,
            appearance: player.appearance,
            state: player.state,
            dynamic_fields: player.dynamic_fields,
            updated_at: new Date().toISOString(),
          })
          .eq('id', player.id)

        if (error) throw error
      } else {
        // Create new player
        const { data, error } = await supabase
          .from('players')
          .insert({
            session_id: session.id,
            name: player.name,
            appearance: player.appearance,
            state: player.state,
            dynamic_fields: player.dynamic_fields || {},
          })
          .select()
          .single()

        if (error) throw error
        setPlayer(data)
      }

      toast.success('角色已保存！')

      // If this is the first time creating the character, start the game
      // (only if the player is not already dead — HP=0 at init means something is wrong)
      if (!characterCreated) {
        setCharacterCreated(true)
        // Check HP before starting: if HP is already 0, block game start and show death screen
        // Read from player_core_stats (authoritative source), not dynamic_fields
        const { data: hpCheck } = await supabase
          .from('player_core_stats')
          .select('current_hp')
          .eq('session_id', params.id as string)
          .maybeSingle()
        const savedHp = hpCheck?.current_hp ?? 10
        if (savedHp <= 0) {
          setIsGameOver(true)
          setGameOverPlayerName(player?.name ? String(player.name) : '')
          toast.error('角色血量为0，无法开始游戏')
          return
        }
        if (messages.length === 0 && !starterSentRef.current) {
          starterSentRef.current = true
          // Fetch the world starter text
          const { data: worldData } = await supabase
            .from('worlds')
            .select('starter, description, name, tone')
            .eq('id', session.world_id)
            .single()
          const w = worldData as { starter?: string | null; description?: string | null; name?: string; tone?: string } | null
          let worldStarter = w?.starter?.trim() || w?.description?.trim() || null
          if (!worldStarter && w?.name) {
            worldStarter = `欢迎来到《${w.name}》的世界。${w.tone ? `\n\n这是一个${w.tone}的世界。` : ''}\n\n游戏开始了，你的冒险从这里出发…`
          }
          setTimeout(() => triggerGameStart(session.id, worldStarter ?? undefined), 300)
        }
      }
    } catch (error) {
      console.error('Failed to save player:', error)
      toast.error('保存失败')
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!newMessage.trim()) {
      return
    }

    const messageContent = newMessage.trim()
    
    // Optimistically add the message to the local state
    const optimisticMessage: Message = {
      id: `temp-${Date.now()}`, // Temporary ID
      session_id: params.id as string,
      author: 'player',
      content: messageContent,
      created_at: new Date().toISOString(),
    }
    
    setMessages((prev) => [...prev, optimisticMessage])
    setNewMessage('')

    try {
      const { data, error } = await supabase
        .from('session_messages')
        .insert({
          session_id: params.id as string,
          author: 'player',
          content: messageContent,
        })
        .select()
        .single()

      if (error) throw error

      // Replace the optimistic message with the real one from the database
      setMessages((prev) => 
        prev.map(msg => 
          msg.id === optimisticMessage.id 
            ? { ...data, id: data.id }
            : msg
        )
      )

      // Call DM response API via SSE stream (reuse shared helper)
      await streamDMResponse(params.id as string, messageContent)
      // All state updates are now awaited in the workflow — SSE 'done' fires
      // only after Nodes 11-19 complete. A single refresh picks up everything.
      await Promise.all([refreshPlayerData(), fetchStoryProgress()])

    } catch {
      // Remove the optimistic message on error
      setMessages((prev) => prev.filter(msg => msg.id !== optimisticMessage.id))
      setNewMessage(messageContent) // Restore the message content
      toast.error('Failed to send message')
    }
  }

  const sendMetaAction = async (marker: string) => {
    if (isStreaming || inputBlocked) return
    // Reuse the same send flow with the marker as content
    setNewMessage(marker)
    // Trigger form submit programmatically via the same logic
    const optimisticMessage: Message = {
      id: `temp-${Date.now()}`,
      session_id: params.id as string,
      author: 'player',
      content: marker,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMessage])
    try {
      const { data, error } = await supabase
        .from('session_messages')
        .insert({ session_id: params.id as string, author: 'player', content: marker })
        .select().single()
      if (error) throw error
      setMessages((prev) => prev.map(msg => msg.id === optimisticMessage.id ? { ...data, id: data.id } : msg))
      await streamDMResponse(params.id as string, marker)
      await Promise.all([refreshPlayerData(), fetchStoryProgress()])
    } catch {
      setMessages((prev) => prev.filter(msg => msg.id !== optimisticMessage.id))
      toast.error('查询失败')
    }
    setNewMessage('')
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="p-8">Loading session...</div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className={`h-screen flex flex-col p-4 gap-3 overflow-hidden relative transition-all duration-700 ${
        combatNpc ? 'ring-1 ring-red-500/30 bg-red-950/5' : ''
      }`}>

        {/* ── GAME OVER OVERLAY (death) ─────────────────────────────────── */}
        {isGameOver && !gameOverDismissed && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-bg-0/95 backdrop-blur-sm">
            <Skull className="w-20 h-20 text-red-400/70" strokeWidth={1.2} />
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-bold text-fg-0 tracking-wide">
                {gameOverPlayerName ? `${gameOverPlayerName} 已陨落` : '冒险者已陨落'}
              </h2>
              <p className="text-fg-1 text-base">HP 归零，魂归幻象</p>
            </div>
            <div className="flex gap-3 mt-2">
              <Button
                onClick={() => router.push('/sessions')}
                className="bg-bg-2 hover:bg-bg-1 text-fg-0 border border-border"
              >
                返回大厅
              </Button>
              <Button
                onClick={() => setGameOverDismissed(true)}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
              >
                回顾叙事
              </Button>
            </div>
          </div>
        )}

        {/* ── GAME COMPLETE OVERLAY (story ending) ────────────────────── */}
        {isGameComplete && gameCompleteData && !gameCompleteDismissed && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-bg-0/95 backdrop-blur-sm">
            <Trophy className={`w-20 h-20 ${
              gameCompleteData.endingType === 'ending_good'
                ? 'text-[#F2B880]/80'
                : 'text-fg-2/60'
            }`} strokeWidth={1.2} />
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-bold text-fg-0 tracking-wide">
                {gameCompleteData.endingType === 'ending_good' ? '冒险完成' : '故事终结'}
              </h2>
              <p className="text-fg-1 text-base">{gameCompleteData.endingName}</p>
              {gameCompleteData.playerName && (
                <p className="text-fg-2 text-sm">
                  {gameCompleteData.playerName} 的旅程到此结束
                </p>
              )}
            </div>
            {/* Summary stats */}
            <div className="flex gap-6 text-sm text-fg-2">
              <div className="text-center">
                <div className="text-lg font-bold text-fg-0">
                  {messages.filter(m => m.author === 'player').length}
                </div>
                <div>行动次数</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-fg-0">
                  {messages.filter(m => (m.author as string) === 'dice').length}
                </div>
                <div>骰子判定</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-fg-0">
                  {storyNodes.filter(n => n.status === 'completed').length}/{storyNodes.length}
                </div>
                <div>完成节点</div>
              </div>
            </div>
            <div className="flex gap-3 mt-2">
              <Button
                onClick={() => router.push('/sessions')}
                className="bg-bg-2 hover:bg-bg-1 text-fg-0 border border-border"
              >
                返回大厅
              </Button>
              <Button
                onClick={() => setGameCompleteDismissed(true)}
                className="bg-[#F2B880]/20 hover:bg-[#F2B880]/30 text-[#F2B880] border border-[#F2B880]/30"
              >
                回顾叙事
              </Button>
            </div>
          </div>
        )}

        {/* ── COMBAT START OVERLAY (auto-dismiss 2.5s) ────────────────── */}
        {combatStartOverlay && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-red-950/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="flex flex-col items-center gap-4 animate-in zoom-in-95 duration-500">
              <Swords className="w-16 h-16 text-red-400 animate-pulse" strokeWidth={1.5} />
              <h2 className="text-4xl font-bold text-red-300 tracking-widest">⚔ 战斗开始</h2>
              <p className="text-lg text-red-200/80">{combatStartOverlay}</p>
            </div>
          </div>
        )}

        {/* ── COMBAT VICTORY OVERLAY (manual dismiss) ──────────────────── */}
        {combatVictoryOverlay && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-amber-950/70 backdrop-blur-sm animate-in fade-in duration-300">
            <Trophy className="w-16 h-16 text-amber-400" strokeWidth={1.3} />
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-bold text-amber-200 tracking-wide">战斗胜利</h2>
              <p className="text-amber-300/80 text-base">{combatVictoryOverlay} 已被击败</p>
            </div>
            <Button
              onClick={() => setCombatVictoryOverlay(null)}
              className="mt-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40"
            >
              继续冒险
            </Button>
          </div>
        )}

        {/* ── PLAYER PANEL (collapsible, compact by default) ───────────── */}
        <Card className="bg-bg-1 border-border flex-shrink-0">
          {/* Compact row — always visible */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            {/* Player name */}
            <span className="text-sm font-semibold text-fg-0 min-w-[4rem] truncate">
              {player?.name || '未命名'}
            </span>

            {/* Current location */}
            {currentLocationName && (
              <span className="flex items-center gap-1 text-xs flex-shrink-0 text-emerald-400">
                <Map className="w-3 h-3" />
                <span className="font-medium truncate max-w-[6rem]">{currentLocationName}</span>
              </span>
            )}

            {/* Key stats inline — core stats + dynamic fields + custom attributes */}
            <div className="flex-1 flex items-center gap-4 overflow-x-auto scrollbar-none">
              {/* Core stats: HP/MP/ATK/DEF */}
              {coreStatsDisplay && (
                <>
                  <span className="flex items-baseline gap-1 text-xs flex-shrink-0">
                    <Heart className="w-3 h-3 text-red-400" />
                    <span className="font-mono text-red-400 font-medium">{coreStatsDisplay.current_hp}/{coreStatsDisplay.max_hp}</span>
                  </span>
                  {coreStatsDisplay.max_mp > 0 && (
                    <span className="flex items-baseline gap-1 text-xs flex-shrink-0">
                      <Zap className="w-3 h-3 text-blue-400" />
                      <span className="font-mono text-blue-400 font-medium">{coreStatsDisplay.current_mp}/{coreStatsDisplay.max_mp}</span>
                    </span>
                  )}
                  <span className="flex items-baseline gap-1 text-xs flex-shrink-0">
                    <Swords className="w-3 h-3 text-orange-400" />
                    <span className="font-mono text-orange-400 font-medium">
                      {coreStatsDisplay.attack + equipBonus.atk}
                      {equipBonus.atk > 0 && <span className="text-orange-400/50 text-[10px]">({coreStatsDisplay.attack}+{equipBonus.atk})</span>}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-1 text-xs flex-shrink-0">
                    <Shield className="w-3 h-3 text-cyan-400" />
                    <span className="font-mono text-cyan-400 font-medium">
                      {coreStatsDisplay.defense + equipBonus.def}
                      {equipBonus.def > 0 && <span className="text-cyan-400/50 text-[10px]">({coreStatsDisplay.defense}+{equipBonus.def})</span>}
                    </span>
                  </span>
                  <span className="text-fg-2/30 text-xs">|</span>
                </>
              )}
              {playerFields.filter(f => !/^(hp|mp|生命值|法力值|mana|health)$/i.test(f.field_name)).slice(0, 5).map((field) => {
                const val = (player?.dynamic_fields as Record<string, unknown>)?.[field.field_name]
                return (
                  <span key={field.id} className="flex items-baseline gap-1 text-xs flex-shrink-0">
                    <span className="text-fg-2">{field.field_name}</span>
                    <span className="font-mono text-fg-0 font-medium">{String(val ?? '—')}</span>
                  </span>
                )
              })}
              {/* Five-dimension custom attributes */}
              {customAttrs && (
                <>
                  <span className="text-fg-2/30 text-xs">|</span>
                  {Object.entries(CUSTOM_ATTR_LABELS).map(([key, label]) => (
                    <span key={key} className="flex items-baseline gap-1 text-xs flex-shrink-0">
                      <span className="text-[#6EE7F2]/70">{label}</span>
                      <span className="font-mono text-[#6EE7F2] font-medium">{customAttrs[key] ?? 0}</span>
                    </span>
                  ))}
                </>
              )}
              {/* Compact inventory count: equipped / backpack / abilities */}
              {inventoryItems.length > 0 && (
                <>
                  <span className="text-fg-2/30 text-xs">|</span>
                  {inventoryItems.some(i => i.slot_type !== 'ability' && isEquipment(i)) && (
                    <span className="flex items-baseline gap-1 text-xs flex-shrink-0">
                      <Swords className="w-3 h-3 text-[#E8A87C]/70" />
                      <span className="text-[#E8A87C]/70">{inventoryItems.filter(i => i.slot_type !== 'ability' && isEquipment(i)).length}</span>
                    </span>
                  )}
                  <span className="flex items-baseline gap-1 text-xs flex-shrink-0">
                    <Package className="w-3 h-3 text-[#F2B880]/70" />
                    <span className="text-[#F2B880]/70">{inventoryItems.filter(i => i.slot_type !== 'ability' && !isEquipment(i)).length}</span>
                  </span>
                  {inventoryItems.some(i => i.slot_type === 'ability') && (
                    <span className="flex items-baseline gap-1 text-xs flex-shrink-0">
                      <Sparkles className="w-3 h-3 text-[#6EE7F2]/70" />
                      <span className="text-[#6EE7F2]/70">{inventoryItems.filter(i => i.slot_type === 'ability').length}</span>
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Save + expand */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                size="sm"
                onClick={handleSavePlayer}
                className="h-7 px-3 text-xs bg-accent hover:bg-accent/90 text-bg-0"
              >
                保存
              </Button>
              <button
                onClick={() => setPlayerPanelExpanded(v => !v)}
                className="p-1 rounded text-fg-2 hover:text-fg-0 hover:bg-bg-2 transition-colors"
                title={playerPanelExpanded ? '收起角色信息' : '展开角色信息'}
              >
                {playerPanelExpanded
                  ? <ChevronUp className="w-4 h-4" />
                  : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Expanded form — only when open */}
          {playerPanelExpanded && (
            <CardContent className="pt-0 pb-3 border-t border-border/40">
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="player-name" className="text-xs text-fg-2">名字</Label>
                  <Input
                    id="player-name"
                    value={player?.name || ''}
                    onChange={(e) => setPlayer({ ...player!, name: e.target.value })}
                    placeholder="输入角色名称"
                    className="h-8 text-sm bg-bg-2 border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="player-appearance" className="text-xs text-fg-2">外貌</Label>
                  <Input
                    id="player-appearance"
                    value={player?.appearance || ''}
                    onChange={(e) => setPlayer({ ...player!, appearance: e.target.value })}
                    placeholder="外貌描述（可选）"
                    className="h-8 text-sm bg-bg-2 border-border"
                  />
                </div>
                {playerFields.map((field) => (
                  <div key={field.id} className="space-y-1.5">
                    <Label htmlFor={`field-${field.id}`} className="text-xs text-fg-2">
                      {field.field_name}
                    </Label>
                    <Input
                      id={`field-${field.id}`}
                      type={field.field_type === 'number' ? 'number' : 'text'}
                      value={String((player?.dynamic_fields as Record<string, unknown>)?.[field.field_name] ?? '')}
                      readOnly
                      className="h-8 text-sm bg-bg-2 border-border opacity-60 cursor-not-allowed"
                    />
                  </div>
                ))}
              </div>

              {/* ── Inventory & Abilities ── */}
              {inventoryItems.length > 0 && (() => {
                // Consolidate same-name items into single entries to avoid duplicate display
                type ConsolidatedItem = InventoryRow & { totalQty: number }
                const consolidateItems = (items: InventoryRow[]): ConsolidatedItem[] => {
                  const record: Record<string, ConsolidatedItem> = {}
                  for (const item of items) {
                    // Equipped items in different slots must NOT be consolidated
                    // (e.g. two 破旧短剑 in weapon_1 and weapon_2 are separate entries)
                    const key = item.equipped && item.slot_type
                      ? `${item.item_name.toLowerCase().trim()}::${item.slot_type}`
                      : item.item_name.toLowerCase().trim()
                    const existing = record[key]
                    if (existing) {
                      existing.totalQty += item.quantity
                      // Keep the version with richer metadata
                      if (!existing.items && item.items) {
                        existing.items = item.items
                        existing.id = item.id
                      }
                      if (item.equipped && !existing.equipped) existing.equipped = true
                    } else {
                      record[key] = { ...item, totalQty: item.quantity }
                    }
                  }
                  return Object.values(record)
                }
                const nonAbilityItems = inventoryItems.filter(i => i.slot_type !== 'ability')
                const consolidated = consolidateItems(nonAbilityItems)
                const equippedItems = consolidated.filter(i => isEquipment(i))
                const unequippedItems = consolidated.filter(i => !isEquipment(i))
                const abilities = inventoryItems.filter(i => i.slot_type === 'ability')
                /** Get description from items join or custom_properties fallback */
                const getDesc = (row: InventoryRow): string | null =>
                  row.items?.description
                  ?? (row.custom_properties?.description as string | undefined)
                  ?? null
                /** Build short stat tags from item_stats JSONB */
                const getStatTags = (row: InventoryRow): string[] => {
                  const s = row.items?.item_stats
                  if (!s || typeof s !== 'object') return []
                  const tags: string[] = []
                  if (typeof s.atk_bonus === 'number' && s.atk_bonus > 0) tags.push(`ATK+${s.atk_bonus}`)
                  if (typeof s.def_bonus === 'number' && s.def_bonus > 0) tags.push(`DEF+${s.def_bonus}`)
                  if (typeof s.damage === 'number' && s.damage > 0) tags.push(`ATK${s.damage}`)
                  if (typeof s.hp_restore === 'number' && s.hp_restore > 0) tags.push(`HP+${s.hp_restore}`)
                  if (typeof s.mp_restore === 'number' && s.mp_restore > 0) tags.push(`MP+${s.mp_restore}`)
                  if (typeof s.mp_cost === 'number' && s.mp_cost > 0) tags.push(`MP${s.mp_cost}`)
                  return tags
                }
                const SLOT_LABELS: Record<string, string> = {
                  weapon_1: '主手', weapon_2: '副手',
                  armor_head: '头盔', armor_chest: '胸甲', armor_legs: '腿甲',
                  accessory_1: '饰品1', accessory_2: '饰品2', accessory_3: '饰品3', accessory_4: '饰品4',
                }
                const ALL_SLOT_KEYS = Object.keys(SLOT_LABELS)
                // Map equipped items to specific slots (handle generic 'weapon'/'armor' types)
                const slotMap: Record<string, ConsolidatedItem | undefined> = {}
                for (const item of equippedItems) {
                  const st = item.slot_type ?? ''
                  if (SLOT_LABELS[st]) {
                    slotMap[st] = item
                  } else if (st === 'weapon') {
                    for (const s of ['weapon_1', 'weapon_2']) {
                      if (!slotMap[s]) { slotMap[s] = item; break }
                    }
                  } else if (st === 'armor') {
                    for (const s of ['armor_chest', 'armor_head', 'armor_legs']) {
                      if (!slotMap[s]) { slotMap[s] = item; break }
                    }
                  } else if (st === 'accessory') {
                    for (const s of ['accessory_1', 'accessory_2', 'accessory_3', 'accessory_4']) {
                      if (!slotMap[s]) { slotMap[s] = item; break }
                    }
                  }
                }
                return (
                  <div className="mt-3 space-y-2">
                    {/* Equipment slots grid */}
                    <div className="p-2 rounded-md bg-[#E8A87C]/5 border border-[#E8A87C]/20">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Swords className="w-3 h-3 text-[#E8A87C]" />
                        <span className="text-xs text-[#E8A87C] font-semibold">装备栏</span>
                      </div>
                      <div className="space-y-0.5">
                        {ALL_SLOT_KEYS.map(slotKey => {
                          const item = slotMap[slotKey]
                          const label = SLOT_LABELS[slotKey]
                          if (item) {
                            const desc = getDesc(item)
                            const isExpanded = expandedItemId === item.id
                            return (
                              <button
                                key={slotKey}
                                onClick={() => desc && setExpandedItemId(isExpanded ? null : item.id)}
                                className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs transition-colors ${
                                  isExpanded
                                    ? 'bg-[#E8A87C]/20 text-[#E8A87C]'
                                    : 'hover:bg-[#E8A87C]/10 text-[#E8A87C]/90'
                                } ${desc ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                <span className="w-8 text-[10px] text-[#E8A87C]/50 text-right shrink-0">{label}</span>
                                <span className="text-[#E8A87C]">{item.item_name}</span>
                                {getStatTags(item).map(tag => (
                                  <span key={tag} className="text-[10px] text-[#E8A87C]/60 font-mono">{tag}</span>
                                ))}
                                {desc && <Info className="w-2.5 h-2.5 opacity-40 ml-auto shrink-0" />}
                              </button>
                            )
                          }
                          return (
                            <div key={slotKey} className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs">
                              <span className="w-8 text-[10px] text-fg-3/40 text-right shrink-0">{label}</span>
                              <span className="text-fg-3/30">—</span>
                            </div>
                          )
                        })}
                      </div>
                      {equippedItems.some(i => expandedItemId === i.id) && (() => {
                        const selected = equippedItems.find(i => i.id === expandedItemId)
                        const desc = selected ? getDesc(selected) : null
                        if (!desc) return null
                        return (
                          <div className="mt-1 px-2 py-1.5 rounded bg-[#E8A87C]/5 border border-[#E8A87C]/15 text-[10px] text-fg-1 leading-relaxed">
                            {desc}
                          </div>
                        )
                      })()}
                    </div>
                    {/* Unequipped items (backpack) */}
                    {unequippedItems.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Package className="w-3 h-3 text-[#F2B880]" />
                          <span className="text-xs text-fg-2 font-medium">背包</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-1.5">
                            {unequippedItems.map(item => {
                              const desc = getDesc(item)
                              const isExpanded = expandedItemId === item.id
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => desc && setExpandedItemId(isExpanded ? null : item.id)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs transition-colors ${
                                    isExpanded
                                      ? 'bg-[#F2B880]/20 border-[#F2B880]/40 text-[#F2B880]'
                                      : 'bg-[#F2B880]/10 border-[#F2B880]/20 text-[#F2B880] hover:bg-[#F2B880]/15'
                                  } ${desc ? 'cursor-pointer' : 'cursor-default'}`}
                                >
                                  {item.item_name}
                                  {getStatTags(item).map(tag => (
                                    <span key={tag} className="text-[10px] text-[#F2B880]/50 font-mono">{tag}</span>
                                  ))}
                                  {item.totalQty > 1 && <span className="text-[#F2B880]/60">x{item.totalQty}</span>}
                                  {desc && <Info className="w-2.5 h-2.5 opacity-50" />}
                                </button>
                              )
                            })}
                          </div>
                          {unequippedItems.some(i => expandedItemId === i.id) && (() => {
                            const selected = unequippedItems.find(i => i.id === expandedItemId)
                            const desc = selected ? getDesc(selected) : null
                            if (!desc) return null
                            return (
                              <div className="px-2 py-1.5 rounded bg-[#F2B880]/5 border border-[#F2B880]/15 text-[10px] text-fg-1 leading-relaxed">
                                {desc}
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                    )}
                    {abilities.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Sparkles className="w-3 h-3 text-[#6EE7F2]" />
                          <span className="text-xs text-fg-2 font-medium">技能</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-1.5">
                            {abilities.map(a => {
                              const desc = getDesc(a)
                              const isExpanded = expandedItemId === a.id
                              return (
                                <button
                                  key={a.id}
                                  onClick={() => desc && setExpandedItemId(isExpanded ? null : a.id)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs transition-colors ${
                                    isExpanded
                                      ? 'bg-[#6EE7F2]/20 border-[#6EE7F2]/40 text-[#6EE7F2]'
                                      : 'bg-[#6EE7F2]/10 border-[#6EE7F2]/20 text-[#6EE7F2] hover:bg-[#6EE7F2]/15'
                                  } ${desc ? 'cursor-pointer' : 'cursor-default'}`}
                                >
                                  {a.item_name}
                                  {getStatTags(a).map(tag => (
                                    <span key={tag} className="text-[10px] text-[#6EE7F2]/50 font-mono">{tag}</span>
                                  ))}
                                  {desc && <Info className="w-2.5 h-2.5 opacity-50" />}
                                </button>
                              )
                            })}
                          </div>
                          {/* Expanded description for selected ability */}
                          {abilities.some(a => expandedItemId === a.id) && (() => {
                            const selected = abilities.find(a => a.id === expandedItemId)
                            const desc = selected ? getDesc(selected) : null
                            if (!desc) return null
                            return (
                              <div className="px-2 py-1.5 rounded bg-[#6EE7F2]/5 border border-[#6EE7F2]/15 text-[10px] text-fg-1 leading-relaxed">
                                {desc}
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </CardContent>
          )}
        </Card>

        {/* ── STORY PROGRESS (collapsible, always visible) ──────────── */}
        <div className="flex-shrink-0">
          <button
            onClick={() => setStoryPanelOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-fg-2 hover:text-fg-0 transition-colors w-full"
          >
            <Map className="w-3.5 h-3.5" />
            <span>故事进度 {storyNodes.length > 0 && `(已完成 ${storyNodes.filter(n => n.status === 'completed').length} / 发现 ${storyNodes.length})`}</span>
            {storyPanelOpen ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
          </button>
          {storyPanelOpen && (
            <div className="px-3 pb-2 flex flex-wrap gap-2">
              {storyNodes.length === 0 ? (
                <span className="text-[10px] text-fg-2/50 py-1">暂无故事节点</span>
              ) : (
                storyNodes.map(node => (
                  <div
                    key={node.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
                      node.status === 'completed'
                        ? 'bg-green-500/10 border-green-500/30 text-green-400'
                        : node.status === 'active'
                        ? 'bg-[#F2B880]/10 border-[#F2B880]/30 text-[#F2B880]'
                        : 'bg-bg-2 border-border text-fg-2'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      node.status === 'completed' ? 'bg-green-400' :
                      node.status === 'active' ? 'bg-[#F2B880] animate-pulse' :
                      'bg-fg-2/40'
                    }`} />
                    <span>{node.status === 'active' && !isGameOver && !isGameComplete ? '???' : node.name}</span>
                    <span className="text-[10px] opacity-60">{NODE_TYPE_LABELS[node.node_type] ?? node.node_type}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── ENEMY INFO PANEL (combat only, collapsible) ──────────── */}
        {combatNpc && (
          <div className="flex-shrink-0 mx-1 mb-1">
            <div className="rounded-lg border border-red-500/40 bg-red-950/20 px-3 py-2">
              {/* Always-visible row: name + HP bar + expand toggle */}
              <button
                className="w-full flex items-center gap-2 text-left"
                onClick={() => setEnemyPanelExpanded(prev => !prev)}
              >
                <Swords className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <span className="font-semibold text-red-300 text-xs">{combatNpc.npcName}</span>
                <span className="flex items-center gap-1 text-xs ml-auto">
                  <Heart className="w-3 h-3 text-red-400" />
                  <span className={`font-mono font-medium ${combatNpc.hp <= combatNpc.maxHp * 0.5 ? 'text-red-400' : 'text-red-300'}`}>
                    {combatNpc.hp}/{combatNpc.maxHp}
                  </span>
                  {combatNpc.maxMp > 0 && (
                    <>
                      <Zap className="w-3 h-3 text-purple-400 ml-2" />
                      <span className="font-mono font-medium text-purple-300">{combatNpc.mp}/{combatNpc.maxMp}</span>
                    </>
                  )}
                </span>
                {enemyPanelExpanded ? <ChevronUp className="w-3.5 h-3.5 text-red-400/60" /> : <ChevronDown className="w-3.5 h-3.5 text-red-400/60" />}
              </button>
              {/* NPC action this turn (shown below HP bar when available) */}
              {combatNpc.npcAction && (
                <div className="flex items-center gap-2 mt-1.5 px-0.5 text-xs">
                  <span className="text-red-400/70">{'▸'}</span>
                  <span className="text-red-300/90">
                    使用「<span className="font-semibold text-red-200">{combatNpc.npcAction.abilityName}</span>」
                    {combatNpc.npcAction.damageDealt > 0
                      ? <span> → <span className="font-mono font-semibold text-red-400">{combatNpc.npcAction.damageDealt}</span> 伤害</span>
                      : <span className="text-red-300/50"> → 未命中</span>
                    }
                    {combatNpc.npcAction.mpCost > 0 && (
                      <span className="text-purple-400/70 ml-1">(-{combatNpc.npcAction.mpCost}MP)</span>
                    )}
                  </span>
                </div>
              )}
              {/* Expanded details */}
              {enemyPanelExpanded && (
                <div className="mt-2 pt-2 border-t border-red-500/20 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="flex items-center gap-1">
                      <Swords className="w-3 h-3 text-orange-400" />
                      <span className="font-mono font-medium text-orange-300">ATK {combatNpc.attack}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Shield className="w-3 h-3 text-cyan-400" />
                      <span className="font-mono font-medium text-cyan-300">DEF {combatNpc.defense}</span>
                    </span>
                  </div>
                  {(combatNpc.equipment.length > 0 || combatNpc.abilities.length > 0) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-red-300/80">
                      {combatNpc.equipment.length > 0 && (
                        <span>装备：{combatNpc.equipment.map(e => e.name).join(' | ')}</span>
                      )}
                      {combatNpc.abilities.length > 0 && (
                        <span>技能：{combatNpc.abilities.map(a => `${a.name}(${a.damage}dmg${a.mpCost > 0 ? `/${a.mpCost}mp` : ''})`).join(' ')}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CHAT PANEL (fills remaining space) ───────────────────────── */}
        <Card className="bg-bg-1 border-border flex-1 flex flex-col min-h-0 overflow-hidden">
          <CardContent className="flex-1 flex flex-col gap-4 min-h-0 overflow-hidden pt-3">
            {/* Messages */}
            <div className={`flex-1 overflow-y-auto space-y-3 p-4 rounded-lg transition-colors duration-700 ${
              combatNpc ? 'bg-red-950/10 border border-red-500/20' : 'bg-bg-2'
            }`}>
              {messages.length === 0 && !characterCreated ? (
                <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#F2B880]/20 to-[#6EE7F2]/20 flex items-center justify-center">
                    <User className="w-8 h-8 text-[#F2B880]" />
                  </div>
                  <div>
                    <p className="text-fg-0 font-medium text-lg mb-1">创建你的角色</p>
                    <p className="text-fg-2 text-sm">在上方展开角色面板，填写角色名称后点击保存，即可开始冒险。</p>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <p className="text-fg-1 text-center">暂无消息，冒险即将开始...</p>
              ) : (
                messages.map((message) => {
                  // Render persistent dice result cards
                  if ((message.author as string) === 'dice') {
                    try {
                      const d: DiceData = JSON.parse(message.content)
                      return (
                        <div key={message.id} className="flex justify-center my-2">
                          <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg bg-bg-0 border border-[#F2B880]/40 text-sm">
                            <span className="text-[#F2B880] font-semibold">{d.diceType}</span>
                            <span className="text-fg-2">|</span>
                            <span className="font-mono text-fg-0">
                              d12 = {d.roll}
                              {d.modifier !== 0 && <span className="text-fg-2"> + {d.modifier}</span>}
                              <span className="text-fg-2"> = </span>
                              <span className={`font-bold ${
                                d.critSuccess ? 'text-green-400' :
                                d.critFail ? 'text-red-400' : 'text-fg-0'
                              }`}>{d.total}</span>
                            </span>
                            <span className="text-fg-2">vs DC</span>
                            <span className="font-mono font-bold text-fg-0">{d.dc}</span>
                            {d.outcome && (
                              <>
                                <span className="text-fg-2">{'\u2192'}</span>
                                <span className={`font-semibold ${
                                  d.outcome === 'CRITICAL_SUCCESS' ? 'text-green-400' :
                                  d.outcome === 'SUCCESS' ? 'text-[#6EE7F2]' :
                                  d.outcome === 'PARTIAL' ? 'text-yellow-400' :
                                  d.outcome === 'FAILURE' ? 'text-orange-400' :
                                  d.outcome === 'CRITICAL_FAILURE' ? 'text-red-400' :
                                  'text-fg-0'
                                }`}>
                                  {d.outcome === 'CRITICAL_SUCCESS' ? '大成功！' :
                                   d.outcome === 'SUCCESS' ? '成功' :
                                   d.outcome === 'PARTIAL' ? '勉强成功' :
                                   d.outcome === 'FAILURE' ? '失败' :
                                   d.outcome === 'CRITICAL_FAILURE' ? '大失败！' :
                                   d.outcome}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    } catch { return null }
                  }

                  // Render persistent combat event banners
                  if ((message.author as string) === 'combat_event') {
                    try {
                      const ce: CombatEventData = JSON.parse(message.content)
                      const isStart = ce.eventType === 'combat_start'
                      return (
                        <div key={message.id} className="flex justify-center my-3">
                          <div className={`inline-flex items-center gap-3 px-5 py-2.5 rounded-lg text-sm font-semibold ${
                            isStart
                              ? 'bg-red-950/40 border border-red-500/50 text-red-300'
                              : 'bg-amber-950/30 border border-amber-500/50 text-amber-300'
                          }`}>
                            <Swords className="w-4 h-4" />
                            <span>{isStart ? `⚔ 战斗开始 — ${ce.npcName}` : `🏆 战斗胜利 — ${ce.npcName} 已被击败`}</span>
                            <Swords className="w-4 h-4" />
                          </div>
                        </div>
                      )
                    } catch { return null }
                  }

                  const isPlayer = message.author === 'player'

                  return (
                    <div
                      key={message.id}
                      className={`flex items-start gap-2 ${isPlayer ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isPlayer && (
                        <div className="w-6 h-6 rounded-full bg-[#F2B880] text-bg-0 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                          GM
                        </div>
                      )}
                      <div className={`max-w-[75%] px-3 py-2 rounded-lg ${
                        isPlayer
                          ? 'bg-bg-2 text-fg-0 border border-[#6EE7F2]/30'
                          : 'bg-bg-1 text-fg-0 border border-border'
                      }`}>
                        <div className="text-sm whitespace-pre-wrap">
                          {META_DISPLAY_MAP[message.content] ?? message.content}
                        </div>
                      </div>
                      {isPlayer && (
                        <div className="w-6 h-6 rounded-full bg-[#6EE7F2] text-bg-0 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                          P
                        </div>
                      )}
                    </div>
                  )
                })
              )}
              {/* Live dice card (shown during streaming before persisted to messages) */}
              {diceResult && isStreaming && (
                <div className="flex justify-center my-2">
                  <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg bg-bg-0 border border-[#F2B880]/40 text-sm animate-pulse">
                    <span className="text-[#F2B880] font-semibold">{diceResult.diceType}</span>
                    <span className="text-fg-2">|</span>
                    <span className="font-mono text-fg-0">
                      d12 = {diceResult.roll}
                      {diceResult.modifier !== 0 && <span className="text-fg-2"> + {diceResult.modifier}</span>}
                      <span className="text-fg-2"> = </span>
                      <span className={`font-bold ${
                        diceResult.critSuccess ? 'text-green-400' :
                        diceResult.critFail ? 'text-red-400' : 'text-fg-0'
                      }`}>{diceResult.total}</span>
                    </span>
                    <span className="text-fg-2">vs DC</span>
                    <span className="font-mono font-bold text-fg-0">{diceResult.dc}</span>
                    {diceResult.outcome && (
                      <>
                        <span className="text-fg-2">{'\u2192'}</span>
                        <span className={`font-semibold ${
                          diceResult.outcome === 'CRITICAL_SUCCESS' ? 'text-green-400' :
                          diceResult.outcome === 'SUCCESS' ? 'text-[#6EE7F2]' :
                          diceResult.outcome === 'PARTIAL' ? 'text-yellow-400' :
                          diceResult.outcome === 'FAILURE' ? 'text-orange-400' :
                          diceResult.outcome === 'CRITICAL_FAILURE' ? 'text-red-400' :
                          'text-fg-0'
                        }`}>
                          {diceResult.outcome === 'CRITICAL_SUCCESS' ? '大成功！' :
                           diceResult.outcome === 'SUCCESS' ? '成功' :
                           diceResult.outcome === 'PARTIAL' ? '勉强成功' :
                           diceResult.outcome === 'FAILURE' ? '失败' :
                           diceResult.outcome === 'CRITICAL_FAILURE' ? '大失败！' :
                           diceResult.outcome}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
              {/* Streaming DM message (shown while response is being generated) */}
              {isStreaming && (
                <div className="flex items-start gap-2 justify-start">
                  <div className="w-6 h-6 rounded-full bg-[#F2B880] text-bg-0 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                    GM
                  </div>
                  <div className="max-w-[75%] px-3 py-2 rounded-lg bg-bg-1 text-fg-0 border border-border">
                    {streamingContent ? (
                      <div className="text-sm whitespace-pre-wrap">
                        {streamingContent}<span className="animate-pulse">▍</span>
                      </div>
                    ) : (
                      /* Pipeline step progress indicator */
                      <div className="py-1 space-y-2 min-w-[260px]">
                        {/* Step dots + connectors */}
                        <div className="flex items-start">
                          {PIPELINE_STEPS.map((step, i) => {
                            const isDone    = maxPipelineIdx > i
                            const isCurrent = maxPipelineIdx === i
                            const isLast    = i === PIPELINE_STEPS.length - 1
                            return (
                              <div key={step.key} className="flex items-start">
                                <div className="flex flex-col items-center gap-1">
                                  <div className={`w-2 h-2 rounded-full border-[1.5px] transition-all duration-300 ${
                                    isDone    ? 'bg-[#F2B880] border-[#F2B880]' :
                                    isCurrent ? 'bg-transparent border-fg-0 animate-pulse' :
                                                'bg-transparent border-fg-2/30'
                                  }`} />
                                  <span className={`text-[9px] leading-tight whitespace-nowrap transition-colors duration-300 ${
                                    isDone    ? 'text-[#F2B880]/70' :
                                    isCurrent ? 'text-fg-0 font-medium' :
                                                'text-fg-2/30'
                                  }`}>
                                    {step.label}
                                  </span>
                                </div>
                                {!isLast && (
                                  <div className={`w-5 h-[2px] mt-[4px] mx-0.5 rounded-full transition-all duration-500 ${
                                    i < maxPipelineIdx
                                      ? 'bg-[#F2B880]/60'
                                      : 'bg-fg-2/20'
                                  }`} />
                                )}
                              </div>
                            )
                          })}
                        </div>
                        {/* Thin progress bar */}
                        <div className="w-full bg-bg-0/60 rounded-full h-[3px] overflow-hidden">
                          <div
                            className="h-full bg-[#F2B880]/60 rounded-full transition-all duration-700 ease-out"
                            style={{
                              width: `${Math.max(6,
                                ((maxPipelineIdx + 1) /
                                  PIPELINE_STEPS.length) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick META action buttons + Tips */}
            {characterCreated && !isGameOver && !isGameComplete && (
              <div className="flex items-center gap-1.5 flex-shrink-0 pb-1">
                {META_BUTTONS.map(btn => (
                  <button
                    key={btn.marker}
                    type="button"
                    onClick={() => sendMetaAction(btn.marker)}
                    disabled={isStreaming || inputBlocked}
                    className="px-2.5 py-1 text-[11px] rounded-md border border-border bg-bg-2 text-fg-1 hover:bg-bg-1 hover:border-[#6EE7F2]/30 hover:text-[#6EE7F2] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {btn.label}
                  </button>
                ))}

                {/* Tips button */}
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="ml-auto p-1 rounded-md border border-border bg-bg-2 text-fg-2 hover:bg-bg-1 hover:border-[#6EE7F2]/30 hover:text-[#6EE7F2] transition-colors"
                      title="游玩提示"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg border-border max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-[#6EE7F2] flex items-center gap-2">
                        <HelpCircle className="w-4 h-4" />
                        游玩提示
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm text-fg-1 leading-relaxed">
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">1.</span>
                        <p>{'发现装备后，需要先'}<span className="text-[#6EE7F2]">{'「拾取」'}</span>{'到背包中，再进行'}<span className="text-[#6EE7F2]">{'「装备」'}</span>{'。直接说"穿上"不会生效——先捡起来，再穿上。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">2.</span>
                        <p>{'交互时尽量使用对象的'}<span className="text-[#6EE7F2]">{'完整名称'}</span>{'，例如"拾取「影刃匕首」"而非"拿那把刀"。名称越明确，DM 越能准确执行你的行动。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">3.</span>
                        <p>{'复合指令请用'}<span className="text-[#6EE7F2]">{'空格'}</span>{'分隔物品/技能和目标，例如"'}<span className="text-[#6EE7F2]">{'使用 雷电之戒 攻击 幻影刺客'}</span>{'"、"'}<span className="text-[#6EE7F2]">{'释放 火球术 攻击 幻影刺客'}</span>{'"。不加空格可能导致系统无法正确识别。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-amber-400 font-mono shrink-0">4.</span>
                        <p>{'每条消息尽量只做'}<span className="text-amber-400">{'一个行动'}</span>{'。多个行动合并发送时，如果其中一个触发了骰子检定并失败，'}<span className="text-amber-400">{'所有行动都会被丢弃'}</span>{'（包括本该成功的部分）。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">5.</span>
                        <p>进入<span className="text-[#6EE7F2]">战斗</span>后为回合制——你的每条消息 = 一个回合。合法行动：物理攻击、施法、使用道具、尝试逃脱。其他行为（探索、闲聊）会被视为<span className="text-amber-400">浪费回合</span>，敌人照常攻击你。</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-amber-400 font-mono shrink-0">6.</span>
                        <p>{'想要发起战斗时，最好'}<span className="text-amber-400">{'指明目标'}</span>{'，例如"攻击「幻影刺客」"或"对「幻影刺客」施放火球术"。只说"攻击敌人"可能导致DM'}<span className="text-amber-400">{'无法判定进入战斗'}</span>{'。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">7.</span>
                        <p>{'探索环境时，用'}<span className="text-[#6EE7F2]">{'主动描述'}</span>{'："仔细观察四周"、"搜索房间"比"看看"更有效，会触发才智(WIT)检定，有机会发现隐藏物品。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">8.</span>
                        <p>上方按钮可快速查看<span className="text-[#6EE7F2]">属性、背包、技能、装备、状态</span>，无需手动输入。战斗数据（伤害、骰子结果）会自动显示在回合日志中。</p>
                      </div>
                      <hr className="border-border/50" />
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">9.</span>
                        <p>{'同一地点同类型检定'}<span className="text-amber-400">{'失败后重试会更难'}</span>{'：每次失败DC+2，连续失败3次后将被'}<span className="text-amber-400">{'锁定'}</span>{'，无法再尝试同一行动。换个地点或换个思路可以重置。战斗不受此限制。'}</p>
                      </div>
                      <hr className="border-border/50" />
                      <p className="text-fg-2 text-xs font-medium">{'伤害计算'}</p>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">10.</span>
                        <p><span className="text-[#6EE7F2]">{'物理/法术攻击'}</span>{'：伤害 = 你的ATK（基础+装备加成）- 敌人DEF，最低1点。装备武器可以提高ATK。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">11.</span>
                        <p>{'骰子结果影响伤害倍率：'}<span className="text-[#6EE7F2]">{'大成功×2'}</span>{'、成功×1、'}<span className="text-amber-400">{'勉强成功×0.5'}</span>{'。失败时你会被敌人反击。'}</p>
                      </div>
                      <hr className="border-border/50" />
                      <p className="text-fg-2 text-xs font-medium">{'骰子规则 (d12)'}</p>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">12.</span>
                        <p>{'骰子修正值 = 对应属性值（如力量、才智等）。最终值 = '}<span className="text-[#6EE7F2]">{'d12 + 属性修正'}</span>{'，与难度等级(DC)比较来判定结果。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-amber-400 font-mono shrink-0">13.</span>
                        <p>{'投出'}<span className="text-amber-400">{'原始 1'}</span>{'（骰子本身为1）= 无条件'}<span className="text-amber-400">{'大失败'}</span>{'，无论加成后总值多高都判定为大失败。这是最坏的结果。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">14.</span>
                        <p>{'投出'}<span className="text-[#6EE7F2]">{'原始 12'}</span>{'（骰子本身为12）= 无条件'}<span className="text-[#6EE7F2]">{'大成功'}</span>{'，无论DC多高都判定为大成功。这是最好的结果。'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#6EE7F2] font-mono shrink-0">15.</span>
                        <p>{'判定阈值：总值 ≥ DC+'}<span className="text-[#6EE7F2]">{'4'}</span>{' → 大成功 | ≥ DC → 成功 | ≥ DC-'}<span className="text-amber-400">{'2'}</span>{' → 勉强成功 | < DC-2 → 失败'}</p>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {/* Message Input */}
            <form onSubmit={handleSendMessage} className="flex gap-2 flex-shrink-0">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder={isStreaming ? 'GM 正在叙述...' : !characterCreated ? '请先创建角色后开始游戏' : (isGameOver || isGameComplete) ? '游戏已结束' : '输入你的行动...'}
                disabled={isStreaming || inputBlocked}
                className="bg-bg-2 border-border"
              />
              <Button
                type="submit"
                disabled={!newMessage.trim() || isStreaming || inputBlocked}
                className="bg-[#6EE7F2] hover:bg-[#6EE7F2]/90 text-bg-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  )
}
