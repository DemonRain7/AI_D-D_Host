/**
 * NODE 12: Inventory Updater
 *
 * Applies ITEM_CONSUMED and ITEM_GAINED mechanical effects.
 * Uses player_inventory table (Phase 3) or dynamic_fields fallback (Phase 2).
 *
 * Fallback: silently skips on any DB error — never crashes the game.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { MechanicalEffect } from '../types/game-mechanics'

export type InventoryUpdaterInput = {
  sessionId: string
  effects: MechanicalEffect[]
  supabase: SupabaseClient
}

export type InventoryUpdaterOutput = {
  applied: boolean
  consumed: string[]
  gained: string[]
}

/**
 * Removes one unit of an item from player_inventory.
 */
async function consumeItemFromTable(
  supabase: SupabaseClient,
  sessionId: string,
  itemName: string
): Promise<boolean> {
  const { data: rows, error } = await supabase
    .from('player_inventory')
    .select('id, quantity')
    .eq('session_id', sessionId)
    .ilike('item_name', itemName)
    .gt('quantity', 0)
    .limit(1)

  if (error || !rows || rows.length === 0) return false

  const row = rows[0]
  if (row.quantity <= 1) {
    await supabase.from('player_inventory').delete().eq('id', row.id)
  } else {
    await supabase
      .from('player_inventory')
      .update({ quantity: row.quantity - 1, updated_at: new Date().toISOString() })
      .eq('id', row.id)
  }
  return true
}

/**
 * Adds one unit of an item to player_inventory (upsert by name).
 * Auto-detects weapon/armor from catalog item_stats and sets equipped + slot_type.
 */
async function gainItemInTable(
  supabase: SupabaseClient,
  sessionId: string,
  itemName: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('player_inventory')
    .select('id, quantity')
    .eq('session_id', sessionId)
    .ilike('item_name', itemName)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('player_inventory')
      .update({ quantity: existing.quantity + 1, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return !error
  }

  // Look up catalog for item_id and auto-equip detection
  const { data: catalogItem } = await supabase
    .from('items')
    .select('id, item_stats')
    .ilike('name', itemName)
    .maybeSingle()

  const extraFields: Record<string, unknown> = {}
  if (catalogItem) {
    extraFields.item_id = catalogItem.id
    const stats = catalogItem.item_stats as Record<string, unknown> | null
    if (stats) {
      const isWeapon = (typeof stats.atk_bonus === 'number' && stats.atk_bonus > 0) ||
                       (typeof stats.damage === 'number' && stats.damage > 0)
      const isArmor = typeof stats.def_bonus === 'number' && stats.def_bonus > 0
      if (isWeapon || isArmor) {
        extraFields.equipped = true
        // Use specific slot names (weapon_1/weapon_2/armor_chest) to avoid duplication
        if (isWeapon) {
          const { data: usedSlots } = await supabase
            .from('player_inventory')
            .select('slot_type')
            .eq('session_id', sessionId)
            .eq('equipped', true)
            .like('slot_type', 'weapon%')
          const taken = new Set((usedSlots ?? []).map((r: { slot_type: string }) => r.slot_type))
          extraFields.slot_type = !taken.has('weapon_1') ? 'weapon_1' : !taken.has('weapon_2') ? 'weapon_2' : 'weapon_1'
        } else {
          extraFields.slot_type = 'armor_chest'
        }
      }
    }
  }

  const { error } = await supabase
    .from('player_inventory')
    .insert({ session_id: sessionId, item_name: itemName, quantity: 1, ...extraFields })
  return !error
}

/**
 * Applies inventory effects to the player state.
 */
export async function applyInventoryChanges(
  input: InventoryUpdaterInput
): Promise<InventoryUpdaterOutput> {
  const { sessionId, effects, supabase } = input

  const consumedEffects = effects.filter(e => e.type === 'ITEM_CONSUMED' && e.itemName)
  const gainedEffects = effects.filter(e => e.type === 'ITEM_GAINED' && e.itemName)

  if (consumedEffects.length === 0 && gainedEffects.length === 0) {
    return { applied: false, consumed: [], gained: [] }
  }

  const consumed: string[] = []
  const gained: string[] = []

  try {
    // Check if player_inventory table exists (Phase 3)
    const { error: tableCheck } = await supabase
      .from('player_inventory')
      .select('id')
      .eq('session_id', sessionId)
      .limit(1)

    const useStructuredTable = !tableCheck

    if (useStructuredTable) {
      // Phase 3: structured table
      for (const effect of consumedEffects) {
        const ok = await consumeItemFromTable(supabase, sessionId, effect.itemName!)
        if (ok) consumed.push(effect.itemName!)
      }
      for (const effect of gainedEffects) {
        const ok = await gainItemInTable(supabase, sessionId, effect.itemName!)
        if (ok) gained.push(effect.itemName!)
      }
    } else {
      // Phase 2 fallback: dynamic_fields inventory array
      const { data: player } = await supabase
        .from('players')
        .select('dynamic_fields')
        .eq('session_id', sessionId)
        .maybeSingle()

      if (!player) return { applied: false, consumed: [], gained: [] }

      const fields = (player.dynamic_fields as Record<string, unknown>) ?? {}
      const inventory = Array.isArray(fields['inventory'])
        ? [...(fields['inventory'] as string[])]
        : []

      for (const effect of consumedEffects) {
        const target = effect.itemName!.toLowerCase()
        const idx = inventory.findIndex(i =>
          typeof i === 'string' && i.toLowerCase() === target
        )
        if (idx !== -1) {
          inventory.splice(idx, 1)
          consumed.push(effect.itemName!)
        }
      }
      for (const effect of gainedEffects) {
        inventory.push(effect.itemName!)
        gained.push(effect.itemName!)
      }

      await supabase
        .from('players')
        .update({ dynamic_fields: { ...fields, inventory }, updated_at: new Date().toISOString() })
        .eq('session_id', sessionId)
    }

    console.log(`[Node 12 · Inventory] 消耗=[${consumed.join(', ')}] 获得=[${gained.join(', ')}]`)
    return { applied: consumed.length > 0 || gained.length > 0, consumed, gained }

  } catch (error) {
    console.error('[Node 12 · Inventory] 出错，静默跳过:', error)
    return { applied: false, consumed: [], gained: [] }
  }
}
