'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Plus, Edit, Trash2, Eye, EyeOff, Heart, Zap, Sword, Shield, Save, Sparkles, Users, Tag, Package } from 'lucide-react'

interface WorldAbility {
  id: string
  name: string
  description: string
}

interface WorldTaxonomy {
  id: string
  name: string
  description: string
}

interface WorldOrganization {
  id: string
  name: string
  description: string
}

interface PlayerField {
  id: string
  world_id: string
  field_name: string
  field_type: 'text' | 'number'
  default_value: string | null
  is_hidden: boolean
  display_order: number
  created_at: string
  updated_at: string
}

interface PlayerDefaults {
  hp: number
  mp: number
  attack: number
  defense: number
}

interface WorldItem {
  id: string
  name: string
  item_stats: Record<string, unknown> | null
}

interface EquipmentSlotData {
  itemId: string | null
  itemName: string
}

const DEFAULT_PLAYER_STATS: PlayerDefaults = { hp: 10, mp: 0, attack: 2, defense: 0 }

interface CustomAttrDefaults {
  combat: number; persuasion: number; chaos: number; charm: number; wit: number
}
const DEFAULT_CUSTOM_ATTRS: CustomAttrDefaults = { combat: 0, persuasion: 0, chaos: 0, charm: 0, wit: 0 }
const CUSTOM_ATTR_LABELS: Record<keyof CustomAttrDefaults, string> = {
  combat: '战斗', persuasion: '游说', chaos: '混沌', charm: '魅力', wit: '才智',
}

const SLOT_LABELS: Record<string, string> = {
  weapon_1: '主手武器', weapon_2: '副手武器',
  armor_head: '头盔', armor_chest: '胸甲', armor_legs: '腿甲',
  accessory_1: '饰品1', accessory_2: '饰品2', accessory_3: '饰品3', accessory_4: '饰品4',
}

const EMPTY_SLOTS: Record<string, EquipmentSlotData> = Object.fromEntries(
  Object.keys(SLOT_LABELS).map(k => [k, { itemId: null, itemName: '' }])
)

function getItemsForSlot(items: WorldItem[], slotType: string): WorldItem[] {
  return items.filter(item => {
    const stats = item.item_stats
    if (!stats || !stats.type) return false
    if (slotType.startsWith('weapon')) return stats.type === 'weapon'
    if (slotType === 'armor_head') return stats.type === 'armor' && stats.armor_slot === 'head'
    if (slotType === 'armor_chest') return stats.type === 'armor' && stats.armor_slot === 'chest'
    if (slotType === 'armor_legs') return stats.type === 'armor' && stats.armor_slot === 'legs'
    if (slotType.startsWith('accessory')) return stats.type === 'accessory'
    return false
  })
}

interface PlayerFieldsManagerProps {
  worldId: string
}

export function PlayerFieldsManager({ worldId }: PlayerFieldsManagerProps) {
  const supabase = createClient()

  // Core stats defaults
  const [playerDefaults, setPlayerDefaults] = useState<PlayerDefaults>({ ...DEFAULT_PLAYER_STATS })
  const [savingDefaults, setSavingDefaults] = useState(false)

  // Custom attribute defaults (five-dimension dice stats)
  const [customAttrDefaults, setCustomAttrDefaults] = useState<CustomAttrDefaults>({ ...DEFAULT_CUSTOM_ATTRS })
  const [savingCustomAttrs, setSavingCustomAttrs] = useState(false)

  // Starter equipment
  const [worldItems, setWorldItems] = useState<WorldItem[]>([])
  const [starterSlots, setStarterSlots] = useState<Record<string, EquipmentSlotData>>({ ...EMPTY_SLOTS })
  const [savingEquipment, setSavingEquipment] = useState(false)

  // Starter associations (abilities, taxonomies, items, organizations)
  const [worldAbilities, setWorldAbilities] = useState<WorldAbility[]>([])
  const [worldTaxonomies, setWorldTaxonomies] = useState<WorldTaxonomy[]>([])
  const [worldOrganizations, setWorldOrganizations] = useState<WorldOrganization[]>([])
  const [starterAbilityIds, setStarterAbilityIds] = useState<Set<string>>(new Set())
  const [starterTaxonomyIds, setStarterTaxonomyIds] = useState<Set<string>>(new Set())
  const [starterItemIds, setStarterItemIds] = useState<Set<string>>(new Set())
  const [starterOrganizationIds, setStarterOrganizationIds] = useState<Set<string>>(new Set())
  const [savingAssociations, setSavingAssociations] = useState(false)

  // Custom fields
  const [fields, setFields] = useState<PlayerField[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedField, setSelectedField] = useState<PlayerField | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    field_name: '',
    field_type: 'text' as 'text' | 'number',
    is_hidden: false,
    default_value: '',
  })

  // === Fetch functions ===

  const fetchPlayerDefaults = useCallback(async () => {
    const { data } = await supabase
      .from('worlds')
      .select('player_defaults, initial_custom_attributes')
      .eq('id', worldId)
      .single()
    if (data?.player_defaults) {
      const d = data.player_defaults as Record<string, number>
      setPlayerDefaults({
        hp: d.hp ?? 10,
        mp: d.mp ?? 0,
        attack: d.attack ?? 2,
        defense: d.defense ?? 0,
      })
    }
    if (data?.initial_custom_attributes) {
      const c = data.initial_custom_attributes as Record<string, number>
      setCustomAttrDefaults({
        combat: c.combat ?? 0, persuasion: c.persuasion ?? 0,
        chaos: c.chaos ?? 0, charm: c.charm ?? 0, wit: c.wit ?? 0,
      })
    }
  }, [supabase, worldId])

  const fetchWorldItems = useCallback(async () => {
    const { data } = await supabase
      .from('items')
      .select('id, name, item_stats')
      .eq('world_id', worldId)
      .order('name')
    setWorldItems((data ?? []) as WorldItem[])
  }, [supabase, worldId])

  const fetchStarterEquipment = useCallback(async () => {
    const { data } = await supabase
      .from('world_starter_equipment')
      .select('item_id, item_name, slot_type')
      .eq('world_id', worldId)
    const slots = { ...EMPTY_SLOTS }
    for (const row of (data ?? []) as { item_id: string; item_name: string; slot_type: string }[]) {
      slots[row.slot_type] = { itemId: row.item_id, itemName: row.item_name }
    }
    setStarterSlots(slots)
  }, [supabase, worldId])

  const fetchWorldAbilities = useCallback(async () => {
    const { data } = await supabase.from('abilities').select('id, name, description').eq('world_id', worldId).order('name')
    setWorldAbilities((data ?? []) as WorldAbility[])
  }, [supabase, worldId])

  const fetchWorldTaxonomies = useCallback(async () => {
    const { data } = await supabase.from('taxonomies').select('id, name, description').eq('world_id', worldId).order('name')
    setWorldTaxonomies((data ?? []) as WorldTaxonomy[])
  }, [supabase, worldId])

  const fetchWorldOrganizations = useCallback(async () => {
    const { data } = await supabase.from('organizations').select('id, name, description').eq('world_id', worldId).order('name')
    setWorldOrganizations((data ?? []) as WorldOrganization[])
  }, [supabase, worldId])

  const fetchStarterAbilities = useCallback(async () => {
    const { data } = await supabase.from('world_starter_abilities').select('ability_id').eq('world_id', worldId)
    setStarterAbilityIds(new Set((data ?? []).map(r => r.ability_id)))
  }, [supabase, worldId])

  const fetchStarterTaxonomies = useCallback(async () => {
    const { data } = await supabase.from('world_starter_taxonomies').select('taxonomy_id').eq('world_id', worldId)
    setStarterTaxonomyIds(new Set((data ?? []).map(r => r.taxonomy_id)))
  }, [supabase, worldId])

  const fetchStarterItems = useCallback(async () => {
    const { data } = await supabase.from('world_starter_items').select('item_id').eq('world_id', worldId)
    setStarterItemIds(new Set((data ?? []).map(r => r.item_id)))
  }, [supabase, worldId])

  const fetchStarterOrganizations = useCallback(async () => {
    const { data } = await supabase.from('world_starter_organizations').select('organization_id').eq('world_id', worldId)
    setStarterOrganizationIds(new Set((data ?? []).map(r => r.organization_id)))
  }, [supabase, worldId])

  const fetchFields = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('world_player_fields')
        .select('*')
        .eq('world_id', worldId)
        .order('display_order', { ascending: true })

      if (error) throw error
      setFields(data || [])
    } catch (err: unknown) {
      console.error('[PlayerFieldsManager] 加载失败:', err)
      toast.error('Failed to load player fields')
    } finally {
      setLoading(false)
    }
  }, [supabase, worldId])

  useEffect(() => {
    fetchPlayerDefaults()
    fetchWorldItems()
    fetchStarterEquipment()
    fetchWorldAbilities()
    fetchWorldTaxonomies()
    fetchWorldOrganizations()
    fetchStarterAbilities()
    fetchStarterTaxonomies()
    fetchStarterItems()
    fetchStarterOrganizations()
    fetchFields()
  }, [fetchPlayerDefaults, fetchWorldItems, fetchStarterEquipment, fetchWorldAbilities, fetchWorldTaxonomies, fetchWorldOrganizations, fetchStarterAbilities, fetchStarterTaxonomies, fetchStarterItems, fetchStarterOrganizations, fetchFields])

  // === Save handlers ===

  const handleSaveDefaults = async () => {
    setSavingDefaults(true)
    try {
      const { error } = await supabase
        .from('worlds')
        .update({ player_defaults: playerDefaults })
        .eq('id', worldId)
      if (error) throw error
      toast.success('Core stats defaults saved')
    } catch (err: unknown) {
      console.error('[PlayerFieldsManager] Defaults save error:', err)
      toast.error('Failed to save defaults')
    } finally {
      setSavingDefaults(false)
    }
  }

  const handleSaveCustomAttrs = async () => {
    setSavingCustomAttrs(true)
    try {
      const { error } = await supabase
        .from('worlds')
        .update({ initial_custom_attributes: customAttrDefaults })
        .eq('id', worldId)
      if (error) throw error
      toast.success('Custom attribute defaults saved')
    } catch (err: unknown) {
      console.error('[PlayerFieldsManager] Custom attrs save error:', err)
      toast.error('Failed to save custom attributes')
    } finally {
      setSavingCustomAttrs(false)
    }
  }

  const handleSaveStarterEquipment = async () => {
    setSavingEquipment(true)
    try {
      await supabase.from('world_starter_equipment').delete().eq('world_id', worldId)
      const rows = Object.entries(starterSlots)
        .filter(([, slot]) => slot.itemId)
        .map(([slotType, slot]) => ({
          world_id: worldId,
          item_id: slot.itemId,
          item_name: slot.itemName,
          slot_type: slotType,
        }))
      if (rows.length > 0) {
        const { error } = await supabase.from('world_starter_equipment').insert(rows)
        if (error) throw error
      }
      toast.success('Starter equipment saved')
    } catch (err: unknown) {
      console.error('[PlayerFieldsManager] Equipment save error:', err)
      toast.error('Failed to save starter equipment')
    } finally {
      setSavingEquipment(false)
    }
  }

  const handleSaveAssociations = async () => {
    setSavingAssociations(true)
    try {
      // Abilities
      await supabase.from('world_starter_abilities').delete().eq('world_id', worldId)
      if (starterAbilityIds.size > 0) {
        await supabase.from('world_starter_abilities').insert(
          Array.from(starterAbilityIds).map(id => ({ world_id: worldId, ability_id: id }))
        )
      }

      // Taxonomies
      await supabase.from('world_starter_taxonomies').delete().eq('world_id', worldId)
      if (starterTaxonomyIds.size > 0) {
        await supabase.from('world_starter_taxonomies').insert(
          Array.from(starterTaxonomyIds).map(id => ({ world_id: worldId, taxonomy_id: id }))
        )
      }

      // Items (non-equipment)
      await supabase.from('world_starter_items').delete().eq('world_id', worldId)
      if (starterItemIds.size > 0) {
        const rows = Array.from(starterItemIds).map(id => {
          const item = worldItems.find(i => i.id === id)
          return { world_id: worldId, item_id: id, item_name: item?.name ?? '' }
        })
        await supabase.from('world_starter_items').insert(rows)
      }

      // Organizations
      await supabase.from('world_starter_organizations').delete().eq('world_id', worldId)
      if (starterOrganizationIds.size > 0) {
        await supabase.from('world_starter_organizations').insert(
          Array.from(starterOrganizationIds).map(id => ({ world_id: worldId, organization_id: id }))
        )
      }

      toast.success('Starter associations saved')
    } catch (err: unknown) {
      console.error('[PlayerFieldsManager] Associations save error:', err)
      toast.error('Failed to save associations')
    } finally {
      setSavingAssociations(false)
    }
  }

  // === Custom fields handlers ===

  const handleAdd = () => {
    setFormData({ field_name: '', field_type: 'text', is_hidden: false, default_value: '' })
    setSelectedField(null)
    setIsEditing(true)
  }

  const handleEdit = (field: PlayerField) => {
    setFormData({
      field_name: field.field_name,
      field_type: field.field_type,
      is_hidden: field.is_hidden,
      default_value: field.default_value || '',
    })
    setSelectedField(field)
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!formData.field_name.trim()) {
      toast.error('Field name is required')
      return
    }

    setSaving(true)
    try {
      if (selectedField) {
        const { error } = await supabase
          .from('world_player_fields')
          .update({
            field_name: formData.field_name.trim(),
            field_type: formData.field_type,
            is_hidden: formData.is_hidden,
            default_value: formData.default_value || null,
          })
          .eq('id', selectedField.id)

        if (error) {
          console.error('[PlayerFieldsManager] 更新失败:', error.message, error.code, error.details, error.hint)
          toast.error(`Save failed: ${error.message}`)
          return
        }
        toast.success('Field updated successfully')
      } else {
        const { error } = await supabase
          .from('world_player_fields')
          .insert({
            world_id: worldId,
            field_name: formData.field_name.trim(),
            field_type: formData.field_type,
            is_hidden: formData.is_hidden,
            default_value: formData.default_value || null,
            display_order: fields.length,
          })

        if (error) {
          console.error('[PlayerFieldsManager] 新增失败:', error.message, error.code, error.details, error.hint)
          toast.error(`Save failed: ${error.message}`)
          return
        }
        toast.success('Field created successfully')
      }

      setIsEditing(false)
      await fetchFields()
    } catch (err: unknown) {
      console.error('[PlayerFieldsManager] 意外错误:', err)
      toast.error('Save failed: unknown error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this field?')) return

    try {
      const { error } = await supabase
        .from('world_player_fields')
        .delete()
        .eq('id', id)

      if (error) throw error
      toast.success('Field deleted successfully')
      await fetchFields()
    } catch (err: unknown) {
      console.error('[PlayerFieldsManager] 删除失败:', err)
      toast.error('Failed to delete field')
    }
  }

  return (
    <div className="space-y-8">
      {/* ========== Core Stats Defaults ========== */}
      <div className="space-y-3 p-5 bg-bg-2 rounded-xl border border-red-500/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-red-400" />
            <Label className="text-red-400 font-semibold text-base">Core Stats Defaults</Label>
          </div>
          <Button
            onClick={handleSaveDefaults}
            disabled={savingDefaults}
            size="sm"
            className="bg-gradient-to-r from-red-500/80 to-[#F2B880]/80 hover:from-[#F2B880] hover:to-red-500 text-bg-0 font-semibold"
          >
            <Save className="w-3 h-3 mr-1" />
            {savingDefaults ? 'Saving...' : 'Save Defaults'}
          </Button>
        </div>
        <p className="text-[10px] text-fg-1/60">Base stats for new players (before equipment). Applied when a new session is created.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-fg-1 flex items-center gap-1"><Heart className="w-3 h-3 text-red-400" /> Default HP</Label>
            <Input type="number" value={playerDefaults.hp}
              onChange={(e) => setPlayerDefaults({ ...playerDefaults, hp: Number(e.target.value) })}
              className="bg-bg-1 border-border h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-fg-1 flex items-center gap-1"><Zap className="w-3 h-3 text-blue-400" /> Default MP</Label>
            <Input type="number" value={playerDefaults.mp}
              onChange={(e) => setPlayerDefaults({ ...playerDefaults, mp: Number(e.target.value) })}
              className="bg-bg-1 border-border h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-fg-1 flex items-center gap-1"><Sword className="w-3 h-3 text-orange-400" /> Default ATK</Label>
            <Input type="number" value={playerDefaults.attack}
              onChange={(e) => setPlayerDefaults({ ...playerDefaults, attack: Number(e.target.value) })}
              className="bg-bg-1 border-border h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-fg-1 flex items-center gap-1"><Shield className="w-3 h-3 text-cyan-400" /> Default DEF</Label>
            <Input type="number" value={playerDefaults.defense}
              onChange={(e) => setPlayerDefaults({ ...playerDefaults, defense: Number(e.target.value) })}
              className="bg-bg-1 border-border h-8 text-sm" />
          </div>
        </div>
      </div>

      {/* ========== Custom Attribute Defaults (Five-Dimension Dice) ========== */}
      <div className="space-y-3 p-5 bg-bg-2 rounded-xl border border-purple-500/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <Label className="text-purple-400 font-semibold text-base">Custom Attribute Defaults</Label>
          </div>
          <Button
            onClick={handleSaveCustomAttrs}
            disabled={savingCustomAttrs}
            size="sm"
            className="bg-gradient-to-r from-purple-500/80 to-[#6EE7F2]/80 hover:from-[#6EE7F2] hover:to-purple-500 text-bg-0 font-semibold"
          >
            <Save className="w-3 h-3 mr-1" />
            {savingCustomAttrs ? 'Saving...' : 'Save Attributes'}
          </Button>
        </div>
        <p className="text-[10px] text-fg-1/60">Initial five-dimension attribute values for new sessions. These grow +1 on successful dice checks.</p>
        <div className="grid grid-cols-5 gap-3">
          {(Object.keys(CUSTOM_ATTR_LABELS) as Array<keyof CustomAttrDefaults>).map((key) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs text-fg-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-400" />
                {CUSTOM_ATTR_LABELS[key]}
              </Label>
              <Input
                type="number"
                key={`${key}-${customAttrDefaults[key]}`}
                defaultValue={customAttrDefaults[key]}
                onBlur={(e) => {
                  const v = e.target.valueAsNumber
                  if (!isNaN(v)) setCustomAttrDefaults(prev => ({ ...prev, [key]: v }))
                }}
                className="bg-bg-1 border-border h-8 text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ========== Starter Equipment ========== */}
      <div className="space-y-3 p-5 bg-bg-2 rounded-xl border border-[#F2B880]/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sword className="w-4 h-4 text-[#F2B880]" />
            <Label className="text-[#F2B880] font-semibold text-base">Starter Equipment</Label>
          </div>
          <Button
            onClick={handleSaveStarterEquipment}
            disabled={savingEquipment}
            size="sm"
            className="bg-gradient-to-r from-[#F2B880]/80 to-[#6EE7F2]/80 hover:from-[#6EE7F2] hover:to-[#F2B880] text-bg-0 font-semibold"
          >
            <Save className="w-3 h-3 mr-1" />
            {savingEquipment ? 'Saving...' : 'Save Equipment'}
          </Button>
        </div>
        <p className="text-[10px] text-fg-1/60">Items automatically equipped when a new player joins. Create items in the Items tab first.</p>
        <div className="space-y-2">
          {Object.entries(SLOT_LABELS).map(([slotType, label]) => {
            const available = getItemsForSlot(worldItems, slotType)
            return (
              <div key={slotType} className="flex items-center gap-3">
                <span className="text-xs text-fg-1 w-20 text-right flex-shrink-0">{label}</span>
                <select
                  value={starterSlots[slotType]?.itemId ?? ''}
                  onChange={(e) => {
                    const itemId = e.target.value || null
                    const item = worldItems.find(i => i.id === itemId)
                    setStarterSlots({
                      ...starterSlots,
                      [slotType]: { itemId, itemName: item?.name ?? '' },
                    })
                  }}
                  className="flex-1 bg-bg-1 border border-border rounded-md px-3 py-1.5 text-sm text-fg-0 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]"
                >
                  <option value="">None</option>
                  {available.map(item => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
        {worldItems.length === 0 && (
          <p className="text-[10px] text-fg-1/40">No items in this world yet. Create items in the Items tab first.</p>
        )}
      </div>

      {/* ========== Starter Associations ========== */}
      {(worldAbilities.length > 0 || worldTaxonomies.length > 0 || worldItems.length > 0 || worldOrganizations.length > 0) && (
        <div className="space-y-4 p-5 bg-bg-2 rounded-xl border border-[#DA77F2]/20">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#DA77F2]" />
              <Label className="text-[#DA77F2] font-semibold text-base">Starter Associations</Label>
            </div>
            <Button
              onClick={handleSaveAssociations}
              disabled={savingAssociations}
              size="sm"
              className="bg-gradient-to-r from-[#DA77F2]/80 to-[#6EE7F2]/80 hover:from-[#6EE7F2] hover:to-[#DA77F2] text-bg-0 font-semibold"
            >
              <Save className="w-3 h-3 mr-1" />
              {savingAssociations ? 'Saving...' : 'Save Associations'}
            </Button>
          </div>
          <p className="text-[10px] text-fg-1/60">Abilities, taxonomies, items, and organizations assigned to new players at session start.</p>

          {/* Starter Abilities */}
          {worldAbilities.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-[#6EE7F2]" />
                <Label className="text-[#6EE7F2] font-semibold text-sm">Abilities</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                {worldAbilities.map((ab) => (
                  <button key={ab.id} type="button"
                    onClick={() => {
                      const next = new Set(starterAbilityIds)
                      if (next.has(ab.id)) next.delete(ab.id); else next.add(ab.id)
                      setStarterAbilityIds(next)
                    }}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                      starterAbilityIds.has(ab.id)
                        ? 'bg-[#6EE7F2]/20 border-[#6EE7F2]/50 text-[#6EE7F2]'
                        : 'bg-bg-1 border-border text-fg-1 hover:border-[#6EE7F2]/30'
                    }`}
                    title={ab.description}
                  >
                    {ab.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Starter Taxonomies */}
          {worldTaxonomies.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3 h-3 text-[#DA77F2]" />
                <Label className="text-[#DA77F2] font-semibold text-sm">Taxonomies</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                {worldTaxonomies.map((tax) => (
                  <button key={tax.id} type="button"
                    onClick={() => {
                      const next = new Set(starterTaxonomyIds)
                      if (next.has(tax.id)) next.delete(tax.id); else next.add(tax.id)
                      setStarterTaxonomyIds(next)
                    }}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                      starterTaxonomyIds.has(tax.id)
                        ? 'bg-[#DA77F2]/20 border-[#DA77F2]/50 text-[#DA77F2]'
                        : 'bg-bg-1 border-border text-fg-1 hover:border-[#DA77F2]/30'
                    }`}
                    title={tax.description}
                  >
                    {tax.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Starter Items */}
          {worldItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Package className="w-3 h-3 text-green-400" />
                <Label className="text-green-400 font-semibold text-sm">Starting Items (non-equipment)</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                {worldItems.map((item) => (
                  <button key={item.id} type="button"
                    onClick={() => {
                      const next = new Set(starterItemIds)
                      if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
                      setStarterItemIds(next)
                    }}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                      starterItemIds.has(item.id)
                        ? 'bg-green-500/20 border-green-500/50 text-green-400'
                        : 'bg-bg-1 border-border text-fg-1 hover:border-green-500/30'
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Starter Organizations */}
          {worldOrganizations.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Users className="w-3 h-3 text-[#F2B880]" />
                <Label className="text-[#F2B880] font-semibold text-sm">Organizations</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                {worldOrganizations.map((org) => (
                  <button key={org.id} type="button"
                    onClick={() => {
                      const next = new Set(starterOrganizationIds)
                      if (next.has(org.id)) next.delete(org.id); else next.add(org.id)
                      setStarterOrganizationIds(next)
                    }}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                      starterOrganizationIds.has(org.id)
                        ? 'bg-[#F2B880]/20 border-[#F2B880]/50 text-[#F2B880]'
                        : 'bg-bg-1 border-border text-fg-1 hover:border-[#F2B880]/30'
                    }`}
                    title={org.description}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== Custom Fields ========== */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-fg-1 mb-2">
              Custom fields for players in this world
            </p>
            <p className="text-fg-1 text-sm">
              Hidden fields are stored but not displayed in the session UI
            </p>
          </div>
          <Button
            onClick={handleAdd}
            className="bg-gradient-to-r from-[#F2B880] to-[#6EE7F2] hover:from-[#6EE7F2] hover:to-[#F2B880] text-bg-0 font-semibold"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Field
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 text-fg-1">
            <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-75" />
            <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse delay-150" />
            Loading fields...
          </div>
        ) : fields.length === 0 ? (
          <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#F2B880]/20 p-8 text-center">
            <p className="text-fg-1 mb-2">No custom player fields defined yet.</p>
            <p className="text-[#F2B880] text-sm">Add fields to customize your player schema!</p>
          </Card>
        ) : (
          <div className="space-y-px">
            <AnimatePresence>
              {fields.map((field, index) => (
                <motion.div
                  key={field.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="bg-gradient-to-r from-bg-1 to-bg-2 border-b border-border hover:bg-bg-2/50 transition-colors group"
                >
                  <div className="flex items-center gap-4 p-4">
                    <div className="flex-1 min-w-0 flex items-center gap-4">
                      <span className="text-fg-0 font-medium w-48 truncate">{field.field_name}</span>
                      <span className="text-[#6EE7F2] text-sm w-32 truncate capitalize">
                        {field.field_type}
                      </span>
                      <span className="text-fg-1 text-sm w-48 truncate">
                        {field.default_value || '—'}
                      </span>
                      <div className="flex items-center gap-2">
                        {field.is_hidden ? (
                          <EyeOff className="w-4 h-4 text-fg-1" />
                        ) : (
                          <Eye className="w-4 h-4 text-[#6EE7F2]" />
                        )}
                        <span className="text-fg-1 text-sm">
                          {field.is_hidden ? 'Hidden' : 'Visible'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEdit(field)}
                        className="p-2 hover:bg-[#6EE7F2]/10 rounded-lg transition-colors"
                      >
                        <Edit className="w-4 h-4 text-[#6EE7F2]" />
                      </button>
                      <button
                        onClick={() => handleDelete(field.id)}
                        className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Edit Modal for Custom Fields */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="bg-bg-0 border-[#F2B880]/30 max-w-2xl">
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#F2B880] to-[#6EE7F2] bg-clip-text text-transparent">
              {selectedField ? 'Edit Field' : 'New Field'}
            </DialogTitle>

            <div className="space-y-2">
              <Label htmlFor="field_name" className="text-[#6EE7F2] font-semibold">
                Field Name *
              </Label>
              <Input
                id="field_name"
                value={formData.field_name}
                onChange={(e) => setFormData({ ...formData, field_name: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#6EE7F2]"
                placeholder="e.g., currency, level, faction"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="field_type" className="text-[#DA77F2] font-semibold">
                Field Type
              </Label>
              <Select
                value={formData.field_type}
                onValueChange={(value: 'text' | 'number') =>
                  setFormData({ ...formData, field_type: value })
                }
              >
                <SelectTrigger className="bg-bg-2 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="default_value" className="text-[#F2B880] font-semibold">
                Default Value (Optional)
              </Label>
              <Input
                id="default_value"
                type={formData.field_type === 'number' ? 'number' : 'text'}
                value={formData.default_value}
                onChange={(e) => setFormData({ ...formData, default_value: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#F2B880]"
                placeholder={`Default ${formData.field_type} value`}
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={formData.is_hidden}
                onCheckedChange={(checked) => setFormData({ ...formData, is_hidden: checked })}
              />
              <Label className="text-fg-0">
                Hidden field (stored but not displayed in session UI)
              </Label>
            </div>

            <div className="flex gap-4 justify-end pt-4">
              <button
                onClick={() => setIsEditing(false)}
                className="text-fg-1 hover:text-fg-0 transition-colors"
              >
                Cancel
              </button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-gradient-to-r from-[#F2B880] to-[#6EE7F2] hover:from-[#6EE7F2] hover:to-[#F2B880] text-bg-0 font-semibold px-8"
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
