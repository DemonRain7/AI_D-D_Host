/**
 * NODE 19B: Deterministic Equipment Manager
 *
 * Two-phase approach:
 *   Phase A — LLM parser: MODEL_FAST tool-call extracts structured
 *             equip/unequip actions from the player message.
 *             Handles complex inputs like "卸下A，装备BCD到各栏位".
 *   Phase B — Deterministic executor: validates items exist in
 *             inventory, enforces category→slot constraints, and
 *             applies changes to the database.
 *
 * Slot constraints (hard reject on mismatch):
 *   weapon  → weapon_1 | weapon_2
 *   armor   → armor_chest
 *   accessory → accessory
 *
 * Runs AFTER Node 19 (so narrative-gained items are already in inventory).
 */

import { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { MODEL_FAST } from '@/lib/config'

// ── Types ─────────────────────────────────────────────────────────────────

export type EquipAction = {
  type: 'equip' | 'unequip'
  itemName: string
  targetSlot?: string   // for equip: weapon_1, weapon_2, armor_chest, accessory
  sourceSlot?: string   // for unequip: specific slot to unequip from
}

type InventoryRow = {
  id: string
  item_name: string
  slot_type: string | null
  equipped: boolean
  items?: { item_stats?: Record<string, unknown> } | null
}

// ── LLM Tool Definition ──────────────────────────────────────────────────

const EQUIP_PARSE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'equip_actions',
    description: 'Extract all equip/unequip actions from the player message, in execution order.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Ordered list of equip/unequip actions. Empty array if no equipment actions.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['equip', 'unequip'],
                description: '"equip" = player wants to wear/wield/put on an item. "unequip" = player wants to remove/take off an item.',
              },
              item_name: {
                type: 'string',
                description: 'Name of the item (use the 「」-marked name from the text if available, otherwise extract the item name as-is).',
              },
              target_slot: {
                type: 'string',
                enum: ['weapon_1', 'weapon_2', 'armor_chest', 'accessory'],
                description: 'Target slot for equip actions, if the player specified one. weapon_1=主手/右手, weapon_2=副手/左手, armor_chest=护甲/防具/盔甲, accessory=饰品. Omit if not specified.',
              },
            },
            required: ['type', 'item_name'],
          },
        },
      },
      required: ['actions'],
    },
  },
}

const EQUIP_PARSE_PROMPT = `你是一个TTRPG装备指令解析器。从玩家消息中提取所有装备/卸下操作。

规则：
- "装备"、"穿上"、"戴上"、"握住"、"装上"、"换上"、"佩戴"、"穿戴"、"换装"、"披上"、"套上"、"穿"、"戴" → type: "equip"
- "卸下"、"脱下"、"摘下"、"取下"、"换下"、"放下"、"卸掉"、"解除装备"、"脱掉"、"摘掉" → type: "unequip"
- 如果玩家指定了栏位（主手、副手、护甲、饰品等），设置 target_slot
- 如果玩家说"先卸下A再装备B"，unequip A 排在 equip B 前面
- 用「」标记的物品名称要原样提取
- 只提取装备/卸下操作，忽略其他动作（拾取、使用、丢弃等不算）
- 如果消息中没有任何装备/卸下操作，返回空数组
- ⚠️ 批量操作：如果玩家说"装备所有"、"全部装备"、"把包里的都装上"等泛指，必须从【背包物品清单】中逐一展开为独立的 equip 操作。每个物品一条记录，item_name 必须是清单中的具体物品名。不要用"所有"或泛指词作为 item_name。
- ⚠️ 消耗品（如药水、水晶等恢复类物品）不属于装备操作，跳过它们。

调用 equip_actions 函数。`

// ── Name Helpers ──────────────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s
    .replace(/[「」『』【】\[\]()（）]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b)
}

// ── Item Category & Slot Validation ──────────────────────────────────────

/** Determine item category from item_stats */
function getItemCategory(stats: Record<string, unknown> | undefined | null): 'weapon' | 'armor' | 'accessory' {
  if (!stats) return 'weapon' // no stats → default weapon

  // Priority 1: explicit type field from catalog
  const explicitType = typeof stats.type === 'string' ? stats.type.toLowerCase() : ''
  if (explicitType === 'weapon') return 'weapon'
  if (explicitType === 'armor') return 'armor'
  if (explicitType === 'accessory') return 'accessory'

  // Priority 2: infer from stat fields
  const hasAtk = (typeof stats.atk_bonus === 'number' && stats.atk_bonus > 0) ||
    (typeof stats.damage === 'number' && stats.damage > 0)
  const hasDef = typeof stats.def_bonus === 'number' && stats.def_bonus > 0

  if (hasAtk && !hasDef) return 'weapon'
  if (hasDef && !hasAtk) return 'armor'
  if (hasAtk && hasDef) return 'accessory'

  return 'accessory'
}

/** Valid slot_types for each item category */
const CATEGORY_VALID_SLOTS: Record<string, string[]> = {
  weapon: ['weapon_1', 'weapon_2'],
  armor: ['armor_chest'],
  accessory: ['accessory_1', 'accessory_2', 'accessory_3', 'accessory_4'],
}

const CATEGORY_LABEL: Record<string, string> = {
  weapon: '武器',
  armor: '护甲',
  accessory: '饰品',
}

const SLOT_LABEL: Record<string, string> = {
  weapon_1: '主手',
  weapon_2: '副手',
  armor_chest: '护甲栏',
  accessory_1: '饰品1',
  accessory_2: '饰品2',
  accessory_3: '饰品3',
  accessory_4: '饰品4',
}

// ── LLM Command Parser ──────────────────────────────────────────────────

/**
 * Parse equip/unequip commands from the player message using LLM tool call.
 * Accepts optional inventory item names so the LLM can expand batch requests
 * like "装备所有" into individual item actions.
 * Returns an ordered list of actions to execute.
 * Falls back to empty array on LLM failure.
 */
export async function parseEquipCommands(
  playerMessage: string,
  openai: OpenAI,
  inventoryItemNames?: string[]
): Promise<EquipAction[]> {
  try {
    // Build user message with inventory context when available
    let userContent = playerMessage
    if (inventoryItemNames && inventoryItemNames.length > 0) {
      userContent = `【背包物品清单】${inventoryItemNames.map(n => `「${n}」`).join('、')}\n\n玩家消息：${playerMessage}`
    }

    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: EQUIP_PARSE_PROMPT },
        { role: 'user', content: userContent },
      ],
      tools: [EQUIP_PARSE_TOOL],
      tool_choice: { type: 'function', function: { name: 'equip_actions' } },
      max_completion_tokens: 400,
    })

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall) || !toolCall.function?.arguments) {
      console.log('[Node 19B · EquipMgr] LLM未返回工具调用，跳过')
      return []
    }

    const result = JSON.parse(toolCall.function.arguments) as {
      actions: Array<{
        type: 'equip' | 'unequip'
        item_name: string
        target_slot?: string
      }>
    }

    const actions: EquipAction[] = (result.actions ?? []).map(a => ({
      type: a.type,
      itemName: a.item_name,
      targetSlot: a.type === 'equip' ? a.target_slot : undefined,
      sourceSlot: a.type === 'unequip' ? a.target_slot : undefined,
    }))

    // Deduplicate
    const seen = new Set<string>()
    return actions.filter(a => {
      const key = `${a.type}:${normalizeName(a.itemName)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  } catch (err) {
    console.error('[Node 19B · EquipMgr] LLM解析失败（跳过装卸）:', err)
    return []
  }
}

// ── Execution ─────────────────────────────────────────────────────────────

/**
 * Execute parsed equip/unequip actions against the database.
 * Validates items exist in inventory and enforces slot constraints.
 */
export async function executeEquipActions(
  actions: EquipAction[],
  sessionId: string,
  supabase: SupabaseClient
): Promise<void> {
  if (actions.length === 0) return

  console.log(`[Node 19B · EquipMgr] 检测到 ${actions.length} 个装卸操作: ${actions.map(a => `${a.type}「${a.itemName}」`).join(', ')}`)

  for (const action of actions) {
    try {
      if (action.type === 'unequip') {
        await doUnequip(action, sessionId, supabase)
      } else {
        await doEquip(action, sessionId, supabase)
      }
    } catch (err) {
      console.error(`[Node 19B · EquipMgr] 操作失败 (${action.type} ${action.itemName}):`, err)
    }
  }
}

// ── Unequip ───────────────────────────────────────────────────────────────

async function doUnequip(
  action: EquipAction,
  sessionId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { data: equipped } = await supabase
    .from('player_inventory')
    .select('id, item_name, slot_type')
    .eq('session_id', sessionId)
    .eq('equipped', true)

  const candidates = (equipped ?? []).filter(
    (row: { slot_type: string | null }) => row.slot_type !== 'ability'
  ) as InventoryRow[]

  // Find by name match; if sourceSlot specified, prefer that slot
  let target = action.sourceSlot
    ? candidates.find(c => namesMatch(c.item_name, action.itemName) && c.slot_type === action.sourceSlot)
    : undefined

  if (!target) {
    target = candidates.find(c => namesMatch(c.item_name, action.itemName))
  }

  if (!target) {
    console.log(`[Node 19B · EquipMgr] 卸下跳过: 已装备物品中没有「${action.itemName}」`)
    return
  }

  await supabase
    .from('player_inventory')
    .update({ equipped: false, slot_type: null, updated_at: new Date().toISOString() })
    .eq('id', target.id)

  console.log(`[Node 19B · EquipMgr] ✓ 卸下「${target.item_name}」(${target.slot_type})`)
}

// ── Equip ─────────────────────────────────────────────────────────────────

async function doEquip(
  action: EquipAction,
  sessionId: string,
  supabase: SupabaseClient
): Promise<void> {
  const { data: allItems } = await supabase
    .from('player_inventory')
    .select('id, item_name, slot_type, equipped, items(item_stats)')
    .eq('session_id', sessionId)

  const nonAbility = ((allItems ?? []) as InventoryRow[]).filter(
    row => row.slot_type !== 'ability'
  )

  // Prefer unequipped copy of the item first, then any copy
  const target =
    nonAbility.find(c => namesMatch(c.item_name, action.itemName) && !c.equipped) ??
    nonAbility.find(c => namesMatch(c.item_name, action.itemName))

  if (!target) {
    console.log(`[Node 19B · EquipMgr] 装备跳过: 背包中没有「${action.itemName}」`)
    return
  }

  // Determine target slot
  // Normalize generic slot names from LLM (e.g. 'accessory' → auto-detect specific slot)
  let targetSlot = action.targetSlot
  if (!targetSlot || targetSlot === 'accessory') {
    targetSlot = await autoDetectSlot(target, sessionId, supabase)
  }

  // Hard reject: item category must match slot type
  const stats = target.items?.item_stats
  const category = getItemCategory(stats)
  const validSlots = CATEGORY_VALID_SLOTS[category] ?? []
  if (validSlots.length > 0 && !validSlots.includes(targetSlot)) {
    console.log(
      `[Node 19B · EquipMgr] ✗ 栏位冲突:「${target.item_name}」是${CATEGORY_LABEL[category] ?? category}，` +
      `不能放入${SLOT_LABEL[targetSlot] ?? targetSlot}（允许: ${validSlots.map(s => SLOT_LABEL[s] ?? s).join('/')}）`
    )
    return
  }

  // If already equipped in the exact target slot, skip
  if (target.equipped && target.slot_type === targetSlot) {
    console.log(`[Node 19B · EquipMgr] 「${target.item_name}」已在 ${targetSlot}，跳过`)
    return
  }

  // Auto-unequip the current occupant of the target slot
  const { data: occupant } = await supabase
    .from('player_inventory')
    .select('id, item_name')
    .eq('session_id', sessionId)
    .eq('equipped', true)
    .eq('slot_type', targetSlot)
    .neq('id', target.id)
    .limit(1)
    .maybeSingle()

  if (occupant) {
    await supabase
      .from('player_inventory')
      .update({ equipped: false, slot_type: null, updated_at: new Date().toISOString() })
      .eq('id', occupant.id)
    console.log(`[Node 19B · EquipMgr] 自动卸下「${(occupant as { item_name: string }).item_name}」(${targetSlot}) → 为「${action.itemName}」让位`)
  }

  // If item was equipped elsewhere (e.g., moving from weapon_2 → weapon_1),
  // this update simply changes the slot_type
  await supabase
    .from('player_inventory')
    .update({
      equipped: true,
      slot_type: targetSlot,
      updated_at: new Date().toISOString(),
    })
    .eq('id', target.id)

  console.log(`[Node 19B · EquipMgr] ✓ 装备「${target.item_name}」→ ${targetSlot}`)
}

// ── Slot Auto-Detection ───────────────────────────────────────────────────

/** Auto-detect slot from item_stats and current equipment state */
async function autoDetectSlot(
  item: InventoryRow,
  sessionId: string,
  supabase: SupabaseClient
): Promise<string> {
  const stats = item.items?.item_stats
  const category = getItemCategory(stats)

  if (category === 'weapon') {
    // Find next available weapon slot
    const { data: usedSlots } = await supabase
      .from('player_inventory')
      .select('slot_type')
      .eq('session_id', sessionId)
      .eq('equipped', true)
      .like('slot_type', 'weapon%')
      .neq('id', item.id)
    const taken = new Set((usedSlots ?? []).map((r: { slot_type: string }) => r.slot_type))
    return !taken.has('weapon_1') ? 'weapon_1' : !taken.has('weapon_2') ? 'weapon_2' : 'weapon_1'
  }

  if (category === 'armor') return 'armor_chest'

  // Accessory: find first available accessory slot
  const { data: usedAccSlots } = await supabase
    .from('player_inventory')
    .select('slot_type')
    .eq('session_id', sessionId)
    .eq('equipped', true)
    .like('slot_type', 'accessory%')
    .neq('id', item.id)
  const takenAcc = new Set((usedAccSlots ?? []).map((r: { slot_type: string }) => r.slot_type))
  for (const s of ['accessory_1', 'accessory_2', 'accessory_3', 'accessory_4']) {
    if (!takenAcc.has(s)) return s
  }
  return 'accessory_1'
}
