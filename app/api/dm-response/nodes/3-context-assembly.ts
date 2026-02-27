/**
 * NODE 3: Context Assembly
 * Builds context sections from retrieved data
 */

import {
  DataRetrievalOutput,
  World,
  Item,
  Location,
  Ability,
  Organization,
  Taxonomy,
  Rule,
  NPC,
  PlayerField,
  Player,
  Message,
} from './2-data-retrieval'
import {
  WORLD_SETTING_HEADER,
  ITEMS_HEADER,
  LOCATIONS_HEADER,
  ABILITIES_HEADER,
  ORGANIZATIONS_HEADER,
  TAXONOMIES_HEADER,
  RULES_HEADER,
  NPCS_HEADER,
  NPC_ACTIONS_HEADER,
  PLAYER_FIELDS_HEADER,
  CURRENT_PLAYER_HEADER,
  CHAT_HISTORY_HEADER,
} from '../prompts'
import type { OutcomeSynthesis } from '../types/game-mechanics'
import type { DiceResolution } from '../types/game-mechanics'
import type { ScenarioEvent } from '../types/custom-dice'
import { CUSTOM_DICE_LABELS } from '../types/custom-dice'
import type { StoryState } from './3e-story-state-loader'
import type { NPCMemory, NPCAction } from '../types/npc-agent'

// Milestone shape (matches session_milestones table row)
export type SessionMilestone = {
  event_summary: string
  event_type: string
  total_score: number
  created_at: string
  turn_number: number | null
}

export type EquippedItemDetail = {
  name: string; slot: string; atk: number; def: number; special: string
}

export type LocationBoundItem = {
  id: string
  name: string
  description: string
  item_stats: Record<string, unknown> | null
}

export type CombatLootItem = {
  name: string
  description: string
  item_stats: Record<string, unknown> | null
}

export type ContextAssemblyInput = DataRetrievalOutput & {
  outcomeSynthesis?: OutcomeSynthesis
  diceResolution?: DiceResolution
  scenarioEvent?: ScenarioEvent
  recentMilestones?: SessionMilestone[]
  storyState?: StoryState
  npcMemories?: NPCMemory[]
  npcActions?: NPCAction[]
  equippedItems?: EquippedItemDetail[]
  playerTotalATK?: number
  playerTotalDEF?: number
  locationBoundItems?: Map<string, LocationBoundItem[]>
  allLocationItemNames?: string[]        // all item names + aliases at current location (for stripping from description)
  combatLootItems?: CombatLootItem[]
  currentLocationId?: string | null      // player's authoritative current location
  currentLocationName?: string | null    // resolved name for DM context
  unlockedNodeIds?: Set<string>          // active + completed story nodes (for item unlock checks)
}

export type ContextAssemblyOutput = {
  worldSettingContext: string
  itemsContext: string
  locationsContext: string
  abilitiesContext: string
  organizationsContext: string
  taxonomiesContext: string
  rulesContext: string
  npcsContext: string
  playerFieldsContext: string
  playerContext: string
  conversationalContext: string
  milestonesContext: string
  scenarioEventContext: string
  mechanicsContext: string
  storyContext: string
  equipmentContext: string
  combatLootContext: string
}

// ============================================================================
// Context Builder Functions
// ============================================================================

function buildWorldSettingContext(world: World): string {
  return `${WORLD_SETTING_HEADER}
Name: ${world.name}
Tone: ${world.tone || 'Not specified'}
Description: ${world.description}
Setting Details: ${world.setting}

`
}

function buildItemsContext(
  items: Item[] | null,
  currentLocationId?: string | null,
  unlockedNodeIds?: Set<string>
): string {
  if (!items || items.length === 0) {
    return ''
  }

  // HARD REMOVE: completely strip items not at player's current location or still locked
  const filtered = items.filter(item => {
    if (currentLocationId && item.location_id && item.location_id !== currentLocationId) return false
    if (unlockedNodeIds && item.unlock_node_id && !unlockedNodeIds.has(item.unlock_node_id)) return false
    return true
  })

  if (filtered.length === 0) return ''

  let context = `\n${ITEMS_HEADER}\n`
  filtered.forEach(item => {
    const aliases = item.aliases?.length ? ` (also known as: ${item.aliases.join(', ')})` : ''
    const unique = item.is_unique ? ' [UNIQUE ITEM]' : ''
    context += `- ${item.name}${aliases}: ${item.description}${unique}\n`
  })
  return context
}

/** Strip item name references from a location description so items are fully dynamic.
 *  Removes 「name」（stats） patterns and cleans up orphaned punctuation. */
function stripItemNamesFromDescription(description: string, itemNames: string[]): string {
  if (itemNames.length === 0) return description

  let result = description
  // Sort by length descending to avoid partial matches (e.g. "力量" before "力量印记")
  const sorted = [...itemNames].sort((a, b) => b.length - a.length)

  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Remove 「name」 with optional stats （...）
    result = result.replace(new RegExp(`「${escaped}」(?:（[^）]*）)?`, 'g'), '')
    // Remove plain name with optional stats （...）— only if ≥3 chars to avoid false positives
    if (name.length >= 3) {
      result = result.replace(new RegExp(`${escaped}(?:（[^）]*）)?`, 'g'), '')
    }
  }

  // Clean up orphaned grammar: connectors, punctuation, measure words left dangling
  result = result
    .replace(/[一二三四五六七八九十]?[枚把副瓶本件个块柄条颗面张道串套][^，。、\n]*?(?=[，。、\n]|$)/g, (match) => {
      // If the measure word phrase has no meaningful content left, remove it
      return match.replace(/[一二三四五六七八九十]?[枚把副瓶本件个块柄条颗面张道串套][的和与及]*\s*$/g, '')
    })
    .replace(/[、，]{2,}/g, '，')       // double comma → single
    .replace(/。\s*[、，]/g, '。')      // period then comma
    .replace(/[、，]\s*。/g, '。')      // comma then period
    .replace(/^\s*[、，]/gm, '')        // leading comma
    .replace(/[、，]\s*$/gm, '')        // trailing comma
    .replace(/。\s*。/g, '。')          // double period
    .replace(/\s{2,}/g, ' ')           // double space
    .trim()

  return result
}

function buildLocationsContext(
  locations: Location[] | null,
  locationBoundItems?: Map<string, LocationBoundItem[]>,
  currentLocationId?: string | null,
  allLocationItemNames?: string[]
): string {
  if (!locations || locations.length === 0) {
    return ''
  }

  // HARD REMOVE: only show locations the player is currently at
  // Other locations are stripped entirely — DM should not know about them
  const filtered = currentLocationId
    ? locations.filter(l => l.id === currentLocationId)
    : locations

  if (filtered.length === 0) return ''

  let context = `\n${LOCATIONS_HEADER}\n`
  filtered.forEach(location => {
    const aliases = location.aliases?.length ? ` (also known as: ${location.aliases.join(', ')})` : ''
    // Strip hardcoded item references from the static description —
    // items are injected dynamically via locationBoundItems below
    const cleanDesc = allLocationItemNames && allLocationItemNames.length > 0
      ? stripItemNamesFromDescription(location.description, allLocationItemNames)
      : location.description
    context += `- ${location.name}${aliases}: ${cleanDesc}\n`

    // Show location-bound items for current location (dynamic, authoritative)
    // Instruct the DM NOT to enumerate them — only mention naturally when player explores
    if (location.id && locationBoundItems?.has(location.id)) {
      const items = locationBoundItems.get(location.id)!
      context += `  [场景中存在的物品（这是权威物品清单。不要主动列举——仅在玩家搜索、观察或尝试拾取时自然融入叙述。提及物品时必须用「」包裹原名，如「守护者臂铠」，不要用""或其他引号。不在此清单中的物品已被拿走或不存在。）]:\n`
      for (const item of items) {
        const stats = item.item_stats
        const bonuses: string[] = []
        if (stats) {
          if (typeof stats.atk_bonus === 'number' && stats.atk_bonus > 0) bonuses.push(`ATK+${stats.atk_bonus}`)
          if (typeof stats.def_bonus === 'number' && stats.def_bonus > 0) bonuses.push(`DEF+${stats.def_bonus}`)
          if (typeof stats.hp_restore === 'number' && stats.hp_restore > 0) bonuses.push(`恢复HP+${stats.hp_restore}`)
          if (typeof stats.mp_restore === 'number' && stats.mp_restore > 0) bonuses.push(`恢复MP+${stats.mp_restore}`)
        }
        const bonusStr = bonuses.length > 0 ? ` (${bonuses.join(', ')})` : ''
        context += `    · 「${item.name}」${bonusStr}: ${item.description}\n`
      }
    }
  })
  return context
}

function buildAbilitiesContext(abilities: Ability[] | null): string {
  if (!abilities || abilities.length === 0) {
    return ''
  }

  let context = `\n${ABILITIES_HEADER}\n`
  abilities.forEach(ability => {
    const aliases = ability.aliases?.length ? ` (also known as: ${ability.aliases.join(', ')})` : ''
    context += `- ${ability.name}${aliases}: ${ability.description}\n`
  })
  return context
}

function buildOrganizationsContext(organizations: Organization[] | null): string {
  if (!organizations || organizations.length === 0) {
    return ''
  }

  let context = `\n${ORGANIZATIONS_HEADER}\n`
  organizations.forEach(org => {
    const aliases = org.aliases?.length ? ` (also known as: ${org.aliases.join(', ')})` : ''
    context += `- ${org.name}${aliases}: ${org.description}\n`
  })
  return context
}

function buildTaxonomiesContext(taxonomies: Taxonomy[] | null): string {
  if (!taxonomies || taxonomies.length === 0) {
    return ''
  }

  let context = `\n${TAXONOMIES_HEADER}\n`
  taxonomies.forEach(tax => {
    const aliases = tax.aliases?.length ? ` (also known as: ${tax.aliases.join(', ')})` : ''
    context += `- ${tax.name}${aliases}: ${tax.description}\n`
  })
  return context
}

function buildRulesContext(rules: Rule[] | null): string {
  if (!rules || rules.length === 0) {
    return ''
  }

  let context = `\n${RULES_HEADER}\n`
  rules.forEach(rule => {
    const aliases = rule.aliases?.length ? ` (also known as: ${rule.aliases.join(', ')})` : ''
    const priority = rule.priority ? ' [HIGH PRIORITY]' : ''
    context += `- ${rule.name}${aliases}: ${rule.description}${priority}\n`
  })
  return context
}

function buildNPCsContext(
  npcs: NPC[] | null,
  npcMemories?: NPCMemory[],
  npcActions?: NPCAction[]
): string {
  if (!npcs || npcs.length === 0) {
    return ''
  }

  // Build lookup maps
  const memoryMap = new Map<string, NPCMemory>()
  if (npcMemories) {
    for (const mem of npcMemories) {
      memoryMap.set(mem.npcName, mem)
    }
  }
  const actionMap = new Map<string, NPCAction>()
  if (npcActions) {
    for (const act of npcActions) {
      actionMap.set(act.npcName, act)
    }
  }

  let context = `\n${NPCS_HEADER}\n`
  npcs.forEach(npc => {
    const aliases = npc.aliases?.length ? ` (also known as: ${npc.aliases.join(', ')})` : ''
    context += `- ${npc.name}${aliases}: ${npc.description}`
    if (npc.personality) context += ` 性格: ${npc.personality}`
    if (npc.motivations) context += ` 目标: ${npc.motivations}`
    context += `\n`

    // Append memory context
    const mem = memoryMap.get(npc.name)
    if (mem && mem.memories.length > 0) {
      context += `  记忆: ${mem.memories.slice(-5).join(' | ')}\n`
      context += `  态度: ${mem.attitude}\n`
    }

    // Append action for this turn
    const act = actionMap.get(npc.name)
    if (act) {
      context += `  本回合行动: ${act.action}`
      if (act.dialogue) context += ` "${act.dialogue}"`
      context += `\n`
    }
  })

  // If any NPC actions exist, add directive for DM
  if (npcActions && npcActions.length > 0) {
    context += `\n${NPC_ACTIONS_HEADER}\n`
    context += `以上NPC的"本回合行动"已经确定。在你的叙事中必须自然地体现这些行动和对话，不要忽略或替换它们。将NPC行动融入场景描写中，使其成为故事的有机组成部分。\n`
  }

  return context
}

function buildPlayerFieldsContext(playerFields: PlayerField[] | null): string {
  if (!playerFields || playerFields.length === 0) {
    return ''
  }

  let context = `\n${PLAYER_FIELDS_HEADER}\n`
  playerFields.forEach(field => {
    const hidden = field.is_hidden ? ' [HIDDEN FROM PLAYER]' : ''
    context += `- ${field.field_name} (${field.field_type})${hidden}\n`
  })
  return context
}

function buildPlayerContext(player: Player | null): string {
  if (!player) {
    return ''
  }

  let context = `\n${CURRENT_PLAYER_HEADER}\n`
  context += `Name: ${player.name}\n`
  context += `Appearance: ${player.appearance}\n`
  if (player.state) context += `Current State: ${player.state}\n`

  if (player.dynamic_fields && Object.keys(player.dynamic_fields).length > 0) {
    context += `Custom Fields:\n`
    Object.entries(player.dynamic_fields).forEach(([key, value]) => {
      context += `- ${key}: ${value}\n`
    })
  }
  return context
}

function buildConversationalContext(messages: Message[] | null): string {
  if (!messages || messages.length === 0) {
    return ''
  }

  let context = `\n${CHAT_HISTORY_HEADER}\n`
  // Reverse to show chronological order (oldest first)
  const chronologicalMessages = [...messages].reverse()
  chronologicalMessages.forEach(message => {
    const author = message.author === 'player' ? 'Player' : 'DM'
    context += `${author}: ${message.content}\n`
  })
  return context
}

// ============================================================================
// Milestones Context Builder
// ============================================================================

const EVENT_TYPE_LABELS: Record<string, string> = {
  COMBAT_VICTORY:   '⚔️ 战斗胜利',
  COMBAT_DEFEAT:    '💀 战斗失败',
  MAJOR_DISCOVERY:  '🔍 重大发现',
  ALLIANCE_FORMED:  '🤝 盟约缔结',
  BETRAYAL:         '🗡️ 背叛',
  QUEST_COMPLETE:   '✅ 任务完成',
  ITEM_ACQUIRED:    '📦 物品获得',
  ABILITY_GAINED:   '✨ 能力习得',
  CHARACTER_DEATH:  '☠️ 角色死亡',
  WORLD_CHANGE:     '🌍 世界改变',
  MORAL_CHOICE:     '⚖️ 道德抉择',
  OTHER:            '📖 重要时刻',
}

/**
 * Formats the most recent story milestones for the DM prompt.
 * Placed after conversation history so the AI "remembers" important
 * events that may have scrolled out of the sliding message window.
 */
function buildMilestonesContext(milestones?: SessionMilestone[]): string {
  if (!milestones || milestones.length === 0) return ''

  let ctx = '\n\n═══ STORY MILESTONES (Key Events This Session) ═══\n'
  ctx += 'These are the most significant story beats so far. Keep them consistent in your narrative.\n'
  for (const m of milestones) {
    const label = EVENT_TYPE_LABELS[m.event_type] ?? '📖 重要时刻'
    const turn  = m.turn_number != null ? ` [Turn ${m.turn_number}]` : ''
    ctx += `• ${label}${turn}: ${m.event_summary}\n`
  }
  ctx += '══════════════════════════════════════════════════\n'
  return ctx
}

// ============================================================================
// Scenario Event Context Builder
// ============================================================================

/**
 * Formats the active scenario event for the DM prompt.
 * Shows BEFORE mechanicsContext so the LLM knows what challenge was presented,
 * even when the dice haven't been resolved yet (or when it's a no-roll event).
 */
function buildScenarioEventContext(scenarioEvent?: ScenarioEvent): string {
  if (!scenarioEvent?.triggered) return ''

  const label = CUSTOM_DICE_LABELS[scenarioEvent.diceType]
  let ctx = '\n\n═══ SCENARIO EVENT (Active Challenge) ═══\n'
  ctx += `Event: ${scenarioEvent.eventTitle}\n`
  ctx += `Dimension: ${label}（${scenarioEvent.diceType}）\n`
  ctx += `DC: ${scenarioEvent.dc}\n`
  ctx += `Description: ${scenarioEvent.eventDescription}\n`
  ctx += '═════════════════════════════════════════\n'
  return ctx
}

// ============================================================================
// Mechanics Context Builder
// ============================================================================

/**
 * Formats dice roll and outcome into a context block for the DM prompt.
 * Tells the LLM what ALREADY happened so it only narrates, not decides.
 */
function buildMechanicsContext(
  outcomeSynthesis?: OutcomeSynthesis,
  diceResolution?: DiceResolution
): string {
  if (!outcomeSynthesis) return ''

  const { outcome, narrativeHint, mechanicalEffects } = outcomeSynthesis

  let context = '\n\n═══ MECHANICAL OUTCOME (ALREADY DETERMINED — narrate this result) ═══\n'
  context += `Outcome: ${outcome}\n`

  if (diceResolution?.rollRequired && diceResolution.rawRoll > 0) {
    const roll = diceResolution.rawRoll
    const mod = diceResolution.modifier >= 0 ? `+${diceResolution.modifier}` : `${diceResolution.modifier}`
    const total = diceResolution.total
    const dieType = diceResolution.rolls[0]?.dieType ?? 'd12'
    const dc = diceResolution.dc !== null ? ` vs DC ${diceResolution.dc}` : ''
    context += `Dice Roll: ${dieType}=${roll} ${mod} = ${total}${dc}\n`
    if (diceResolution.isCriticalSuccess) context += `Special: Natural max — Critical Success!\n`
    if (diceResolution.isCriticalFailure) context += `Special: Natural 1 — Critical Failure!\n`
  }

  if (mechanicalEffects.length > 0) {
    context += `Mechanical Effects Applied:\n`
    mechanicalEffects.forEach(effect => {
      context += `  • ${effect.reason}\n`
    })
  }

  context += `\nNarrative Guidance: ${narrativeHint}\n`
  context += '═══════════════════════════════════════════════════════════════\n'

  return context
}

// ============================================================================
// Story State Context Builder
// ============================================================================

/**
 * Formats current quest and active story nodes into a context block.
 * Tells the DM what story beats are active, what the player can interact with,
 * and what story paths lie ahead — without prescribing player choices.
 */
function buildStoryContext(
  storyState?: StoryState,
  locationBoundItems?: Map<string, LocationBoundItem[]>,
  currentLocationId?: string | null,
  currentLocationName?: string | null
): string {
  if (!storyState || !storyState.initialized) return ''

  let ctx = '\n\n═══ 任务与故事状态 ═══\n'

  // Explicit location declaration — DM must respect this
  if (currentLocationName) {
    ctx += `\n【玩家当前所在地: ${currentLocationName}】\n`
    ctx += '玩家只能与当前所在地的事物交互。其他地点的物品/NPC不可见、不可触碰。\n'
  }

  if (storyState.currentQuestTitle) {
    const questType = storyState.currentQuestType ? ` [${storyState.currentQuestType}]` : ''
    ctx += `当前任务: ${storyState.currentQuestTitle}${questType}\n`
    if (storyState.currentQuestDescription) {
      ctx += `任务目标: ${storyState.currentQuestDescription}\n`
    }
  }

  if (storyState.activeNodes.length > 0) {
    const currentSceneHints: string[] = []
    ctx += '\n当前故事阶段:\n'
    for (const node of storyState.activeNodes) {
      const atCurrentLocation = !currentLocationId || !node.location_id || node.location_id === currentLocationId

      if (atCurrentLocation) {
        // Full details for nodes at current location
        ctx += `• [${node.node_type}] ${node.name}: ${node.description}\n`
        if (node.completion_trigger) {
          ctx += `  完成条件: ${node.completion_trigger}\n`
        }
        if (node.interactive_hints.length > 0) {
          ctx += `  场景内存在: ${node.interactive_hints.join(' | ')}\n`
          currentSceneHints.push(...node.interactive_hints)
        }
      } else {
        // HARD SUPPRESS: nodes at other locations — name only, NO description/hints/trigger
        ctx += `• [${node.node_type}] ${node.name} [位于其他地点，当前不可交互]\n`
      }
    }

    // Available next nodes: ONLY include hints from same-location nodes
    for (const node of storyState.availableNextNodes) {
      if (node.interactive_hints.length > 0) {
        const atCurrentLocation = !currentLocationId || !node.location_id || node.location_id === currentLocationId
        if (atCurrentLocation) {
          currentSceneHints.push(...node.interactive_hints)
        }
      }
    }

    // Inject location-bound items (already filtered by currentLocationId + unlock in workflow)
    if (locationBoundItems && locationBoundItems.size > 0) {
      for (const items of locationBoundItems.values()) {
        for (const item of items) {
          const stats = item.item_stats
          const bonuses: string[] = []
          if (stats) {
            if (typeof stats.atk_bonus === 'number' && stats.atk_bonus > 0) bonuses.push(`ATK+${stats.atk_bonus}`)
            if (typeof stats.def_bonus === 'number' && stats.def_bonus > 0) bonuses.push(`DEF+${stats.def_bonus}`)
          }
          const bonusStr = bonuses.length > 0 ? `（${bonuses.join(', ')}）` : ''
          currentSceneHints.push(`${item.name}${bonusStr}`)
        }
      }
    }

    // Scene boundary: authoritative and exclusive
    if (currentSceneHints.length > 0) {
      ctx += `\n[DM内部·当前场景权威清单] 以下事物确定存在于玩家当前所在场景中: ${currentSceneHints.join('、')}。\n`
      ctx += '规则：此清单是权威的且排他的。清单内的事物玩家可以交互。'
      ctx += '清单外的事物（包括其他地点的物品）绝对不在当前场景中，玩家无法看到、触碰、拾取。'
      ctx += '如果玩家试图与不在此清单中的事物互动，描述"你环顾四周，但这里并没有那个东西"。'
      ctx += '\n⚠️ 重要：不要主动向玩家列举或提示场景中有哪些可拾取物品。物品应在玩家主动搜索、观察环境或尝试拾取时才自然出现在叙述中。描述场景时可以用环境细节暗示（如"角落似乎有什么东西"），但不要直接说出物品名称。\n'
    }
  }

  if (storyState.availableNextNodes.length > 0) {
    ctx += '\n【后续剧情走向（仅供DM内部参考，不要透露给玩家）】\n'
    for (const node of storyState.availableNextNodes) {
      // Only show name for nodes at other locations, not full details
      const atCurrentLocation = !currentLocationId || !node.location_id || node.location_id === currentLocationId
      if (atCurrentLocation) {
        ctx += `• ${node.name}: ${node.description}\n`
        if (node.interactive_hints.length > 0) {
          ctx += `  该区域包含: ${node.interactive_hints.join(' | ')}\n`
        }
      } else {
        ctx += `• ${node.name} [其他地点]\n`
      }
    }
  }

  ctx += '══════════════════════════\n'
  return ctx
}

// ============================================================================
// Combat Loot Context Builder
// ============================================================================

function buildCombatLootContext(lootItems?: CombatLootItem[]): string {
  if (!lootItems || lootItems.length === 0) return ''

  let ctx = '\n\n═══ 战斗掉落物（敌人已被击败，以下物品散落在地） ═══\n'
  ctx += '以下物品从被击败的敌人身上掉落。玩家需要明确表示拾取才能获得。\n'
  ctx += '掉落装备:\n'
  for (const item of lootItems) {
    const stats = item.item_stats
    const bonuses: string[] = []
    if (stats) {
      if (typeof stats.atk_bonus === 'number' && stats.atk_bonus > 0) bonuses.push(`ATK+${stats.atk_bonus}`)
      if (typeof stats.def_bonus === 'number' && stats.def_bonus > 0) bonuses.push(`DEF+${stats.def_bonus}`)
    }
    const bonusStr = bonuses.length > 0 ? ` (${bonuses.join(', ')})` : ''
    ctx += `  · 「${item.name}」${bonusStr}: ${item.description}\n`
  }
  ctx += '═══════════════════════════════════════════════════════\n'
  return ctx
}

// ============================================================================
// Equipment Context Builder
// ============================================================================

const SLOT_LABELS: Record<string, string> = {
  weapon_1: '主手', weapon_2: '副手',
  armor_head: '头盔', armor_chest: '胸甲', armor_legs: '腿甲',
  accessory_1: '饰品1', accessory_2: '饰品2', accessory_3: '饰品3', accessory_4: '饰品4',
}

function buildEquipmentContext(
  items?: EquippedItemDetail[],
  totalATK?: number,
  totalDEF?: number
): string {
  const ALL_SLOTS = Object.keys(SLOT_LABELS)

  // Build a map of slot → item, handling generic slot types like 'weapon'/'armor'
  const slotMap = new Map<string, EquippedItemDetail>()
  const unmapped: EquippedItemDetail[] = []

  if (items) {
    for (const item of items) {
      if (SLOT_LABELS[item.slot]) {
        // Specific slot (weapon_1, armor_chest, etc.)
        slotMap.set(item.slot, item)
      } else {
        // Generic slot type — map to first available specific slot
        let placed = false
        if (item.slot === 'weapon') {
          for (const s of ['weapon_1', 'weapon_2']) {
            if (!slotMap.has(s)) { slotMap.set(s, item); placed = true; break }
          }
        } else if (item.slot === 'armor') {
          for (const s of ['armor_chest', 'armor_head', 'armor_legs']) {
            if (!slotMap.has(s)) { slotMap.set(s, item); placed = true; break }
          }
        }
        if (!placed) unmapped.push(item)
      }
    }
  }

  let ctx = '\n\n═══ PLAYER EQUIPMENT (Consider in ALL interactions) ═══\n'
  ctx += `Total ATK: ${totalATK ?? 0} | Total DEF: ${totalDEF ?? 0}\n`
  ctx += 'Equipment Slots:\n'

  for (const slotKey of ALL_SLOTS) {
    const label = SLOT_LABELS[slotKey]
    const item = slotMap.get(slotKey)
    if (item) {
      const bonuses: string[] = []
      if (item.atk > 0) bonuses.push(`ATK+${item.atk}`)
      if (item.def > 0) bonuses.push(`DEF+${item.def}`)
      const bonusStr = bonuses.length > 0 ? ` (${bonuses.join(', ')})` : ''
      const specialStr = item.special ? ` [特效: ${item.special}]` : ''
      ctx += `  • ${label}: ${item.name}${bonusStr}${specialStr}\n`
    } else {
      ctx += `  • ${label}: （空）\n`
    }
  }

  for (const item of unmapped) {
    const bonuses: string[] = []
    if (item.atk > 0) bonuses.push(`ATK+${item.atk}`)
    if (item.def > 0) bonuses.push(`DEF+${item.def}`)
    const bonusStr = bonuses.length > 0 ? ` (${bonuses.join(', ')})` : ''
    const specialStr = item.special ? ` [特效: ${item.special}]` : ''
    ctx += `  • ${item.slot}: ${item.name}${bonusStr}${specialStr}\n`
  }

  ctx += '以上装备状态是权威的系统数据。当玩家请求装备/卸下物品时，必须根据此数据叙事：如果槽位显示有物品，该物品就是已装备的——绝不能否认其存在或声称槽位为空。\n'
  ctx += 'DM 在所有类型的行动（战斗、社交、探索、施法等）中都必须考虑已装备物品及其特效。\n'
  ctx += '═══════════════════════════════════════════════════════\n'
  return ctx
}

// ============================================================================
// Main Assembly Function
// ============================================================================

/**
 * Assembles all context sections from retrieved data
 */
export async function assembleContext(
  input: ContextAssemblyInput
): Promise<ContextAssemblyOutput> {
  const {
    world,
    items,
    locations,
    abilities,
    organizations,
    taxonomies,
    rules,
    npcs,
    playerFields,
    player,
    messageHistory,
    outcomeSynthesis,
    diceResolution,
    scenarioEvent,
    recentMilestones,
    storyState,
    npcMemories,
    npcActions,
    equippedItems,
    playerTotalATK,
    playerTotalDEF,
    locationBoundItems,
    allLocationItemNames,
    combatLootItems,
    currentLocationId,
    currentLocationName,
    unlockedNodeIds,
  } = input

  return {
    worldSettingContext: buildWorldSettingContext(world),
    itemsContext: buildItemsContext(items, currentLocationId, unlockedNodeIds),
    locationsContext: buildLocationsContext(locations, locationBoundItems, currentLocationId, allLocationItemNames),
    abilitiesContext: buildAbilitiesContext(abilities),
    organizationsContext: buildOrganizationsContext(organizations),
    taxonomiesContext: buildTaxonomiesContext(taxonomies),
    rulesContext: buildRulesContext(rules),
    npcsContext: buildNPCsContext(npcs, npcMemories, npcActions),
    playerFieldsContext: buildPlayerFieldsContext(playerFields),
    playerContext: buildPlayerContext(player),
    conversationalContext: buildConversationalContext(messageHistory),
    milestonesContext: buildMilestonesContext(recentMilestones),
    scenarioEventContext: buildScenarioEventContext(scenarioEvent),
    mechanicsContext: buildMechanicsContext(outcomeSynthesis, diceResolution),
    storyContext: buildStoryContext(storyState, locationBoundItems, currentLocationId, currentLocationName),
    equipmentContext: buildEquipmentContext(equippedItems, playerTotalATK, playerTotalDEF),
    combatLootContext: buildCombatLootContext(combatLootItems),
  }
}
