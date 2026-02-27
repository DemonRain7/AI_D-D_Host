/**
 * NODE 19: Narrative State Sync
 *
 * Post-turn background agent that analyzes the DM response to detect
 * items gained/lost and abilities acquired through narrative (not dice).
 *
 * Problem it solves: The outcome synthesizer (Node 6) only generates
 * ITEM_GAINED/ITEM_CONSUMED for dice-based mechanical outcomes. But many
 * items are given through NPC dialogue, exploration, or story events.
 * Without this node, the DM says "you receive a silver badge" but the
 * inventory table has no record of it, causing precondition checks to fail.
 *
 * One MODEL_FAST call analyzes the DM response and returns structured
 * inventory/ability changes, then persists them to the database.
 *
 * Runs fire-and-forget in the background (Phase 2, after Node 7).
 * Fallback: silently fails (narrative sync is an enhancement).
 */

import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import { MODEL_FAST } from '@/lib/config'

// ── Types ─────────────────────────────────────────────────────────────────

export type NarrativeStateSyncInput = {
  sessionId: string
  worldId: string
  playerMessage: string
  dmResponse: string
  openai: OpenAI
  supabase: SupabaseClient
}

type ItemChange = {
  item_name: string
  change: 'gained' | 'lost' | 'used'
  quantity: number
}

// ── Tool Definition ───────────────────────────────────────────────────────

const SYNC_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'sync_narrative_state',
    description: 'Report items gained/lost based on the DM narrative.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Items gained, lost, or consumed in this turn.',
          items: {
            type: 'object',
            properties: {
              item_name: {
                type: 'string',
                description: 'Name of the item (use the 「」-marked name from the DM text if available).',
              },
              change: {
                type: 'string',
                enum: ['gained', 'lost', 'used'],
                description: 'Whether the player gained, lost, or used/consumed the item.',
              },
              quantity: {
                type: 'number',
                description: 'How many (default 1).',
              },
            },
            required: ['item_name', 'change', 'quantity'],
          },
        },
      },
      required: ['items'],
    },
  },
}

// ── System Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个TTRPG游戏状态同步器。你的任务是分析DM的叙述，检测玩家在这一轮中是否获得、失去、或使用了物品/道具。

注意：
- 不要检测技能/能力的习得或失去
- **施放技能/法术（如"释放火球术"、"使用暗影步"）不是物品消耗**。技能通过MP消耗使用，不从背包中扣除。只有物理消耗品（药水、卷轴、食物等一次性道具）才算 used
- 法术卷轴作为物品处理，通过正常的拾取流程获得

核心原则（最高优先级）：
- **只有玩家确实拿到手的物品才算 gained**
- 场景中"存在"的物品 ≠ 玩家"获得"的物品

gained 的判定（必须同时满足两个条件）：
条件1 — 玩家有明确的获取意图（以下之一）：
- 玩家说了"拾取"、"拿"、"捡"、"收下"、"接受"等主动获取词
- 玩家与NPC交易/对话后NPC主动给予
- 战斗胜利后的战利品掉落

条件2 — DM叙述确认了获取动作（以下之一）：
- DM明确写了玩家"拿起"、"捡起"、"收入背包"、"接过"、"取走"某物品
- NPC明确将物品"交给"、"递给"、"赠与"玩家
- 战斗/事件后DM明确说玩家"获得了"、"得到了"某物品

⚠️ 仅DM单方面描述玩家"发现"物品，但玩家没有主动拾取意图 → 不算gained

绝对不算 gained 的情况（返回空数组）：
- DM描述物品在桌上、架上、地上、箱子里、房间里 → 这只是场景描述
- "你看到桌上放着一把「匕首」" → 不是获得，只是看到
- "角落里有一本「古书」" → 不是获得
- "展示柜中陈列着「银徽」" → 不是获得
- "你发现了「护甲」" / "你注意到「护甲」" → 发现/注意到 ≠ 获得
- "你触摸了「护甲」" / "你感应到「护甲」的力量" → 触摸/感应 ≠ 获得
- "沙地裂缝中露出一件「护甲」" → 只是场景描写
- 任何只描述物品"存在于场景中"而没有描述玩家主动拾取的情况
- 玩家只说了"环顾四周"、"观察"、"检查"等探索类动作时，DM描述中看到的物品都不算获得
- 属性提升（如"才智+1"、"力量增长"等）不是物品，不要记录

其他规则：
- "丢弃"、"失去"、"被夺走"、"消失" → lost
- "使用"、"消耗"、"吃掉"、"喝下" → used
- 用「」标记的物品名称要原样提取（如「试炼银徽」→ item_name: "试炼银徽"）
- 如果这一轮没有任何物品变化，返回空数组
- 不要把场景中的固定物件（祭坛、门、墙壁等）当做玩家获得的物品
- 不要把NPC的物品当做玩家的物品
- quantity 默认为 1
- 不要处理装备/卸下操作（equipped/unequipped），这由独立的装备管理器处理

调用 sync_narrative_state 函数。`

// ── Main Function ─────────────────────────────────────────────────────────

/** Normalize name for fuzzy catalog lookup (strip brackets, whitespace, lowercase) */
function normalizeName(s: string): string {
  return s
    .replace(/[「」『』【】\[\]()（）]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

export async function syncNarrativeState(
  input: NarrativeStateSyncInput
): Promise<void> {
  const { sessionId, worldId, playerMessage, dmResponse, openai, supabase } = input

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `玩家行动: "${playerMessage}"\n\nDM叙述:\n${dmResponse}`,
        },
      ],
      tools: [SYNC_TOOL],
      tool_choice: { type: 'function', function: { name: 'sync_narrative_state' } },
      max_completion_tokens: 400,
    })

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || !('function' in toolCall) || !toolCall.function?.arguments) {
      console.log('[Node 19 · NarrSync] 未返回工具调用，跳过')
      return
    }

    const result = JSON.parse(toolCall.function.arguments) as {
      items: ItemChange[]
    }

    const itemChanges = result.items ?? []

    if (itemChanges.length === 0) {
      console.log('[Node 19 · NarrSync] 本轮无物品变化')
      return
    }

    // ── Pre-fetch catalog items for this world ───────────────────────
    // Used to link item_id FK and store descriptions in custom_properties
    const { data: catalogItems } = await supabase
      .from('items')
      .select('id, name, description, item_stats')
      .eq('world_id', worldId)

    /** Look up a catalog item by normalized name match */
    function findCatalogItem(name: string) {
      return (catalogItems ?? []).find(ci => normalizeName(ci.name) === normalizeName(name))
    }

    // ── Apply item changes ──────────────────────────────────────────────
    for (const item of itemChanges) {
      if (item.change === 'gained') {
        // Check if already exists
        const { data: existing } = await supabase
          .from('player_inventory')
          .select('id, quantity')
          .eq('session_id', sessionId)
          .ilike('item_name', item.item_name)
          .maybeSingle()

        // Look up catalog for item_id and description (no auto-equip — player must equip explicitly)
        const catalogMatch = findCatalogItem(item.item_name)
        const extraFields: Record<string, unknown> = {}
        if (catalogMatch) {
          extraFields.item_id = catalogMatch.id
          extraFields.custom_properties = { description: catalogMatch.description }
          console.log(`[Node 19 · NarrSync] 物品匹配世界目录: 「${item.item_name}」→「${catalogMatch.name}」`)
        }

        if (existing) {
          // Item already exists — it was likely added this turn by Node 10 (mechanical effects).
          // Do NOT increment quantity here to avoid double-counting the same gain event.
          // Only update catalog metadata (item_id, description) if we have it.
          if (Object.keys(extraFields).length > 0) {
            await supabase
              .from('player_inventory')
              .update({ ...extraFields, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
          }
          console.log(`[Node 19 · NarrSync] 物品已存在，跳过重复添加: 「${item.item_name}」`)
        } else {
          await supabase
            .from('player_inventory')
            .insert({
              session_id: sessionId,
              item_name: catalogMatch?.name ?? item.item_name,
              quantity: item.quantity || 1,
              ...extraFields,
            })
          console.log(`[Node 19 · NarrSync] 物品获得: 「${item.item_name}」x${item.quantity || 1}`)
        }
      } else if (item.change === 'lost' || item.change === 'used') {
        const { data: existing } = await supabase
          .from('player_inventory')
          .select('id, quantity')
          .eq('session_id', sessionId)
          .ilike('item_name', item.item_name)
          .maybeSingle()

        if (existing) {
          const newQty = existing.quantity - (item.quantity || 1)
          if (newQty <= 0) {
            await supabase.from('player_inventory').delete().eq('id', existing.id)
          } else {
            await supabase
              .from('player_inventory')
              .update({ quantity: newQty, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
          }
          console.log(`[Node 19 · NarrSync] 物品${item.change === 'used' ? '使用' : '失去'}: 「${item.item_name}」x${item.quantity || 1}`)
        }
      }
      // Note: equipped/unequipped handling removed — now handled by Node 19B (deterministic equipment manager)
    }

    console.log(`[Node 19 · NarrSync] 同步完成: ${itemChanges.length} 个物品变化`)

  } catch (error) {
    console.error('[Node 19 · NarrSync] 出错（非致命）:', error)
  }
}
