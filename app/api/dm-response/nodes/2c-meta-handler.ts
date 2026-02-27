/**
 * NODE 2C: META Action Handler
 *
 * Handles META queries (view abilities, check inventory, etc.) with
 * template-based responses. Skips the full LLM pipeline for instant results.
 *
 * Returns null for HELP/GENERAL queries → caller falls through to LLM pipeline.
 */

import type { PlayerState } from '../types/player-state'

export type MetaSubType =
  | 'CHECK_ABILITIES'
  | 'CHECK_INVENTORY'
  | 'CHECK_EQUIPMENT'
  | 'CHECK_STATS'
  | 'CHECK_STATUS'
  | 'HELP'
  | 'GENERAL'

export type MetaResult = {
  response: string
  subType: MetaSubType
}

// ─── Button marker → friendly display text (used by frontend) ──────────────
export const META_MARKERS: Record<string, { subType: MetaSubType; displayText: string }> = {
  '__META:CHECK_STATS__':     { subType: 'CHECK_STATS',     displayText: '查看属性' },
  '__META:CHECK_INVENTORY__': { subType: 'CHECK_INVENTORY',  displayText: '查看背包' },
  '__META:CHECK_ABILITIES__': { subType: 'CHECK_ABILITIES',  displayText: '查看技能' },
  '__META:CHECK_EQUIPMENT__': { subType: 'CHECK_EQUIPMENT',  displayText: '查看装备' },
  '__META:CHECK_STATUS__':    { subType: 'CHECK_STATUS',     displayText: '查看状态' },
}

/**
 * Classify a META message into a specific sub-type.
 * First checks button markers (__META:...__), then keyword regex.
 */
function classifyMetaSubType(msg: string): MetaSubType {
  // Button markers — 100% accurate
  const trimmed = msg.trim()
  if (trimmed in META_MARKERS) return META_MARKERS[trimmed].subType

  const m = msg.toLowerCase()

  if (/技能|能力|法术|spell|abilit|skill/.test(m)) return 'CHECK_ABILITIES'
  if (/背包|物品|道具|inventory|item|bag|backpack/.test(m)) return 'CHECK_INVENTORY'
  if (/装备|武器|防具|盔甲|equipment|gear|armor|weapon/.test(m)) return 'CHECK_EQUIPMENT'
  if (/属性|HP|MP|ATK|DEF|生命|血量|魔力|攻击力|防御力|stats?/.test(m)) return 'CHECK_STATS'
  if (/状态|buff|debuff|效果|中毒|眩晕|status/.test(m)) return 'CHECK_STATUS'
  if (/怎么玩|规则|帮助|help|rule|how to/.test(m)) return 'HELP'

  return 'GENERAL'
}

// ─── Template formatters ────────────────────────────────────────────────────

function formatAbilities(ps: PlayerState): string {
  const abilities = ps.inventory.filter(i => i.slotType === 'ability')
  if (abilities.length === 0) return '你目前没有习得任何技能。'

  let text = '**你的技能：**\n\n'
  for (const a of abilities) {
    const desc = (a.customProperties?.description as string) ?? ''
    text += `- **${a.itemName}**`
    if (desc) text += `：${desc}`
    text += '\n'
  }
  return text.trim()
}

function formatInventory(ps: PlayerState): string {
  const items = ps.inventory.filter(i => i.slotType !== 'ability')
  if (items.length === 0) return '你的背包空空如也。'

  let text = '**背包物品：**\n\n'
  for (const item of items) {
    const qty = item.quantity > 1 ? ` x${item.quantity}` : ''
    const eq = item.equipped ? ' [已装备]' : ''
    text += `- ${item.itemName}${qty}${eq}\n`
  }
  return text.trim()
}

function formatEquipment(ps: PlayerState): string {
  const equipped = ps.inventory.filter(i => i.equipped)
  if (equipped.length === 0) return '你没有装备任何物品。'

  const SLOT_NAMES: Record<string, string> = {
    weapon_1: '主手', weapon_2: '副手',
    armor_head: '头盔', armor_chest: '胸甲', armor_legs: '腿甲',
    accessory_1: '饰品1', accessory_2: '饰品2', accessory_3: '饰品3', accessory_4: '饰品4',
  }

  let text = '**装备栏：**\n\n'
  for (const item of equipped) {
    const slotName = (item.slotType && SLOT_NAMES[item.slotType]) ?? item.slotType ?? '未知'
    text += `- ${slotName}：**${item.itemName}**\n`
  }
  text += `\n基础 ATK: ${ps.attack} | 基础 DEF: ${ps.defense}`
  return text.trim()
}

function formatStats(ps: PlayerState): string {
  let text = '**角色属性：**\n\n'
  text += `- 生命值 (HP)：${ps.hp} / ${ps.maxHp}\n`
  text += `- 魔力值 (MP)：${ps.mp} / ${ps.maxMp}\n`
  text += `- 攻击力 (ATK)：${ps.attack}\n`
  text += `- 防御力 (DEF)：${ps.defense}\n`

  const ca = ps.customAttributes
  if (ca) {
    text += '\n**五维属性：**\n\n'
    text += `- 战斗：${ca.combat}\n`
    text += `- 游说：${ca.persuasion}\n`
    text += `- 混沌：${ca.chaos}\n`
    text += `- 魅力：${ca.charm}\n`
    text += `- 才智：${ca.wit}\n`
  }
  return text.trim()
}

function formatStatus(ps: PlayerState): string {
  if (ps.statusEffects.length === 0) return '你目前没有任何状态效果。'

  let text = '**当前状态效果：**\n\n'
  for (const se of ps.statusEffects) {
    const typeTag = se.effectType === 'buff' ? '(增益)' : se.effectType === 'debuff' ? '(减益)' : ''
    const duration = se.durationTurns != null ? `，剩余 ${se.durationTurns} 回合` : ''
    const source = se.sourceName ? `，来源：${se.sourceName}` : ''
    text += `- **${se.effectName}** ${typeTag}${source}${duration}\n`
    if (se.description) text += `  ${se.description}\n`
  }
  return text.trim()
}

// ─── Main handler ───────────────────────────────────────────────────────────

/**
 * Attempts to handle a META action with a template response.
 * Returns null if the query needs to fall through to the full LLM pipeline
 * (HELP, GENERAL, or unrecognized sub-types).
 */
export function handleMetaAction(
  playerMessage: string,
  playerState: PlayerState,
  _worldName: string,
): MetaResult | null {
  const subType = classifyMetaSubType(playerMessage)

  console.log(`[Node 2C · Meta] subType=${subType}`)

  switch (subType) {
    case 'CHECK_ABILITIES':
      return { response: formatAbilities(playerState), subType }
    case 'CHECK_INVENTORY':
      return { response: formatInventory(playerState), subType }
    case 'CHECK_EQUIPMENT':
      return { response: formatEquipment(playerState), subType }
    case 'CHECK_STATS':
      return { response: formatStats(playerState), subType }
    case 'CHECK_STATUS':
      return { response: formatStatus(playerState), subType }
    case 'HELP':
    case 'GENERAL':
      // Fall through to full LLM pipeline
      return null
    default:
      return null
  }
}
