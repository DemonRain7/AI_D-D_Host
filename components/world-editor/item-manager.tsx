'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Plus, Edit, Trash2, Star, Sword, Shield, Heart, Sparkles, MapPin, Lock } from 'lucide-react'

type ItemType = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'skill_tome' | 'tool' | ''

interface ItemStats {
  type: ItemType
  atk_bonus?: number     // weapon / accessory
  def_bonus?: number     // weapon (shield) / armor / accessory
  armor_slot?: 'head' | 'chest' | 'legs'  // armor only
  hp_restore?: number    // consumable
  mp_restore?: number    // consumable
  grants_ability?: string  // skill_tome
  special_effect?: string  // weapon / armor / accessory — free-text special effect description
}

interface Item {
  id: string
  world_id: string
  name: string
  aliases: string[] | null
  description: string
  is_unique: boolean
  item_stats: ItemStats | null
  location_id: string | null
  unlock_node_id: string | null
  created_at: string
  updated_at: string
}

interface WorldLocation {
  id: string
  name: string
}

interface StoryNode {
  id: string
  name: string
}

interface ItemManagerProps {
  worldId: string
}

export function ItemManager({ worldId }: ItemManagerProps) {
  const supabase = createClient()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<Item | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [worldLocations, setWorldLocations] = useState<WorldLocation[]>([])
  const [storyNodes, setStoryNodes] = useState<StoryNode[]>([])

  const [formData, setFormData] = useState({
    name: '',
    aliases: '',
    description: '',
    is_unique: false,
    item_stats: { type: '' } as ItemStats,
    location_id: '' as string,
    unlock_node_id: '' as string,
  })

  const fetchItems = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('world_id', worldId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setItems(data || [])
    } catch {
      toast.error('Failed to load items')
    } finally {
      setLoading(false)
    }
  }, [supabase, worldId])

  const fetchLocations = useCallback(async () => {
    const { data } = await supabase
      .from('locations')
      .select('id, name')
      .eq('world_id', worldId)
      .order('name')
    setWorldLocations((data ?? []) as WorldLocation[])
  }, [supabase, worldId])

  const fetchStoryNodes = useCallback(async () => {
    const { data } = await supabase
      .from('story_nodes')
      .select('id, name')
      .eq('world_id', worldId)
      .order('name')
    setStoryNodes((data ?? []) as StoryNode[])
  }, [supabase, worldId])

  useEffect(() => {
    fetchItems()
    fetchLocations()
    fetchStoryNodes()
  }, [fetchItems, fetchLocations, fetchStoryNodes])

  const handleAdd = () => {
    setFormData({
      name: '',
      aliases: '',
      description: '',
      is_unique: false,
      item_stats: { type: '' },
      location_id: '',
      unlock_node_id: '',
    })
    setSelectedItem(null)
    setIsEditing(true)
  }

  const handleEdit = (item: Item) => {
    setFormData({
      name: item.name,
      aliases: item.aliases?.join(', ') || '',
      description: item.description,
      is_unique: item.is_unique,
      item_stats: (item.item_stats as ItemStats) ?? { type: '' },
      location_id: item.location_id ?? '',
      unlock_node_id: item.unlock_node_id ?? '',
    })
    setSelectedItem(item)
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.description.trim()) {
      toast.error('Name and description are required')
      return
    }

    setSaving(true)
    try {
      // Generate embedding for the item
      const embeddingResponse = await fetch('/api/generate-embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim(),
          aliases: formData.aliases
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean),
        }),
      })

      if (!embeddingResponse.ok) {
        throw new Error('Failed to generate embedding')
      }

      const { embedding } = await embeddingResponse.json()

      const itemData: Record<string, unknown> = {
        world_id: worldId,
        name: formData.name.trim(),
        aliases: formData.aliases
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        description: formData.description.trim(),
        is_unique: formData.is_unique,
        item_stats: formData.item_stats.type ? formData.item_stats : {},
        embedding,
      }

      // Only include location_id when user set a value or is clearing a previously set one.
      if (formData.location_id) {
        itemData.location_id = formData.location_id
      } else if (selectedItem?.location_id) {
        itemData.location_id = null
      }

      // unlock_node_id: lock item behind a story node (only meaningful with location_id)
      if (formData.unlock_node_id) {
        itemData.unlock_node_id = formData.unlock_node_id
      } else if (selectedItem?.unlock_node_id) {
        itemData.unlock_node_id = null
      }

      if (selectedItem) {
        const { error } = await supabase
          .from('items')
          .update(itemData)
          .eq('id', selectedItem.id)

        if (error) throw error
        toast.success('Item updated successfully')
      } else {
        const { error } = await supabase.from('items').insert(itemData)

        if (error) throw error
        toast.success('Item created successfully')
      }

      await fetchItems()
      setIsEditing(false)
    } catch (error: unknown) {
      const pgErr = error as { message?: string; details?: string; code?: string }
      const msg = pgErr?.message || (error instanceof Error ? error.message : JSON.stringify(error))
      console.error('Save error:', msg, pgErr?.details, pgErr?.code)
      toast.error(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return

    try {
      const { error } = await supabase.from('items').delete().eq('id', id)

      if (error) throw error

      toast.success('Item deleted successfully')
      await fetchItems()
    } catch {
      toast.error('Failed to delete item')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-fg-1">Manage items and artifacts in this world</p>
        <Button
          onClick={handleAdd}
          className="bg-gradient-to-r from-[#F2B880] to-[#DA77F2] hover:from-[#DA77F2] hover:to-[#F2B880] text-bg-0 font-semibold"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Item
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-fg-1">
          <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse delay-75" />
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-150" />
          Loading items...
        </div>
      ) : items.length === 0 ? (
        <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#F2B880]/20 p-12 text-center">
          <p className="text-fg-1 mb-4">No items yet.</p>
          <p className="text-[#F2B880]">Add your first item to get started!</p>
        </Card>
      ) : (
        <div className="space-y-px">
          <AnimatePresence>
            {items.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: index * 0.02 }}
                className="bg-gradient-to-r from-bg-1 to-bg-2 border-b border-border hover:bg-bg-2/50 transition-colors group"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0 flex items-center gap-4">
                    <div className="flex items-center gap-2 w-48">
                      <span className="text-fg-0 font-medium truncate">{item.name}</span>
                      {item.is_unique && <Star className="w-3 h-3 text-[#F2B880] fill-[#F2B880] flex-shrink-0" />}
                    </div>
                    <span className="text-[#F2B880] text-sm w-64 truncate">
                      {item.aliases?.join(', ') || '—'}
                    </span>
                    <span className="text-fg-1 text-sm flex-1 truncate">
                      {item.description}
                    </span>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(item)}
                      className="p-2 hover:bg-[#6EE7F2]/10 rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4 text-[#6EE7F2]" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
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

      {/* Edit Modal */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="bg-bg-0 border-[#F2B880]/30 max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#F2B880] to-[#DA77F2] bg-clip-text text-transparent">
              {selectedItem ? 'Edit Item' : 'New Item'}
            </DialogTitle>

            <div className="space-y-2">
              <Label htmlFor="name" className="text-[#6EE7F2] font-semibold">
                Name *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#6EE7F2]"
                placeholder="Item name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aliases" className="text-[#DA77F2] font-semibold">
                Aliases
              </Label>
              <Input
                id="aliases"
                value={formData.aliases}
                onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#DA77F2]"
                placeholder="Comma-separated aliases"
              />
              {formData.aliases && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.aliases
                    .split(',')
                    .map((a) => a.trim())
                    .filter(Boolean)
                    .map((alias, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-[#DA77F2]/20 text-[#DA77F2] text-xs rounded-lg border border-[#DA77F2]/30"
                      >
                        {alias}
                      </span>
                    ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-[#F2B880] font-semibold">
                Description *
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#F2B880]"
                rows={6}
                placeholder="Item description, properties, lore, etc."
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-bg-2 rounded-xl border border-border">
              <div className="flex-1">
                <Label htmlFor="is_unique" className="text-[#F2B880] font-semibold">
                  Unique Item
                </Label>
                <p className="text-fg-1 text-sm mt-1">
                  Mark as a one-of-a-kind artifact
                </p>
              </div>
              <Switch
                id="is_unique"
                checked={formData.is_unique}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_unique: checked })
                }
              />
            </div>

            {/* Location Binding */}
            <div className="space-y-2 p-4 bg-bg-2 rounded-xl border border-[#6EE7F2]/20">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-[#6EE7F2]" />
                <Label className="text-[#6EE7F2] font-semibold">Location</Label>
              </div>
              <p className="text-[10px] text-fg-1/60">
                Bind this item to a specific location. Players entering that location will see this item as available to pick up.
              </p>
              <select
                value={formData.location_id}
                onChange={(e) => setFormData({ ...formData, location_id: e.target.value, unlock_node_id: e.target.value ? formData.unlock_node_id : '' })}
                className="w-full bg-bg-1 border border-border rounded-md px-3 py-1.5 text-sm text-fg-0 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]"
              >
                <option value="">None (not location-bound)</option>
                {worldLocations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>

              {/* Unlock Node */}
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-[#DA77F2]" />
                  <Label className="text-[#DA77F2] font-semibold text-xs">Lock until story node</Label>
                </div>
                <p className="text-[10px] text-fg-1/60">
                  Item is locked until this story node becomes active or completed. Leave empty for no lock.
                  {!formData.location_id && ' (Requires a location to be set)'}
                </p>
                <select
                  value={formData.unlock_node_id}
                  onChange={(e) => setFormData({ ...formData, unlock_node_id: e.target.value })}
                  disabled={!formData.location_id}
                  className="w-full bg-bg-1 border border-border rounded-md px-3 py-1.5 text-sm text-fg-0 disabled:opacity-40 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]"
                >
                  <option value="">None (always accessible)</option>
                  {storyNodes.map(node => (
                    <option key={node.id} value={node.id}>{node.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Item Stats */}
            <div className="space-y-3 p-4 bg-bg-2 rounded-xl border border-[#F2B880]/20">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-[#F2B880]" />
                <Label className="text-[#F2B880] font-semibold">Item Mechanics</Label>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-fg-1">Type</Label>
                <select value={formData.item_stats.type}
                  onChange={(e) => setFormData({ ...formData, item_stats: { type: e.target.value as ItemType } })}
                  className="w-full bg-bg-1 border border-border rounded-md px-3 py-1.5 text-sm text-fg-0 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]">
                  <option value="">None (quest/decorative)</option>
                  <option value="weapon">Weapon</option>
                  <option value="armor">Armor</option>
                  <option value="accessory">Accessory</option>
                  <option value="consumable">Consumable</option>
                  <option value="skill_tome">Skill Tome</option>
                  <option value="tool">Tool</option>
                </select>
              </div>
              {formData.item_stats.type === 'weapon' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-fg-1 flex items-center gap-1"><Sword className="w-3 h-3 text-orange-400" /> ATK Bonus</Label>
                      <Input type="number" value={formData.item_stats.atk_bonus ?? 1}
                        onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, atk_bonus: Number(e.target.value) } })}
                        className="bg-bg-1 border-border h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-fg-1 flex items-center gap-1"><Shield className="w-3 h-3 text-cyan-400" /> DEF Bonus</Label>
                      <Input type="number" value={formData.item_stats.def_bonus ?? 0}
                        onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, def_bonus: Number(e.target.value) } })}
                        className="bg-bg-1 border-border h-8 text-sm" placeholder="盾牌等可加DEF" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-fg-1">Special Effect</Label>
                    <Input value={formData.item_stats.special_effect ?? ''}
                      onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, special_effect: e.target.value } })}
                      className="bg-bg-1 border-border h-8 text-sm" placeholder="如：攻击时10%概率造成灼烧" />
                  </div>
                </div>
              )}
              {formData.item_stats.type === 'armor' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-fg-1 flex items-center gap-1"><Shield className="w-3 h-3 text-cyan-400" /> DEF Bonus</Label>
                      <Input type="number" value={formData.item_stats.def_bonus ?? 1}
                        onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, def_bonus: Number(e.target.value) } })}
                        className="bg-bg-1 border-border h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-fg-1">Armor Slot</Label>
                      <select value={formData.item_stats.armor_slot ?? 'chest'}
                        onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, armor_slot: e.target.value as 'head' | 'chest' | 'legs' } })}
                        className="w-full bg-bg-1 border border-border rounded-md px-3 py-1.5 text-sm text-fg-0 h-8 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]">
                        <option value="head">Head</option>
                        <option value="chest">Chest</option>
                        <option value="legs">Legs</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-fg-1">Special Effect</Label>
                    <Input value={formData.item_stats.special_effect ?? ''}
                      onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, special_effect: e.target.value } })}
                      className="bg-bg-1 border-border h-8 text-sm" placeholder="如：受击时15%反弹伤害" />
                  </div>
                </div>
              )}
              {formData.item_stats.type === 'accessory' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-fg-1 flex items-center gap-1"><Sword className="w-3 h-3 text-orange-400" /> ATK Bonus</Label>
                      <Input type="number" value={formData.item_stats.atk_bonus ?? 0}
                        onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, atk_bonus: Number(e.target.value) } })}
                        className="bg-bg-1 border-border h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-fg-1 flex items-center gap-1"><Shield className="w-3 h-3 text-cyan-400" /> DEF Bonus</Label>
                      <Input type="number" value={formData.item_stats.def_bonus ?? 0}
                        onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, def_bonus: Number(e.target.value) } })}
                        className="bg-bg-1 border-border h-8 text-sm" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-fg-1">Special Effect</Label>
                    <Input value={formData.item_stats.special_effect ?? ''}
                      onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, special_effect: e.target.value } })}
                      className="bg-bg-1 border-border h-8 text-sm" placeholder="如：每回合恢复2MP" />
                  </div>
                </div>
              )}
              {formData.item_stats.type === 'consumable' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-fg-1 flex items-center gap-1"><Heart className="w-3 h-3 text-red-400" /> HP Restore</Label>
                    <Input type="number" value={formData.item_stats.hp_restore ?? 0}
                      onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, hp_restore: Number(e.target.value) } })}
                      className="bg-bg-1 border-border h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-fg-1">MP Restore</Label>
                    <Input type="number" value={formData.item_stats.mp_restore ?? 0}
                      onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, mp_restore: Number(e.target.value) } })}
                      className="bg-bg-1 border-border h-8 text-sm" />
                  </div>
                </div>
              )}
              {formData.item_stats.type === 'skill_tome' && (
                <div className="space-y-1">
                  <Label className="text-xs text-fg-1">Grants Ability</Label>
                  <Input value={formData.item_stats.grants_ability ?? ''}
                    onChange={(e) => setFormData({ ...formData, item_stats: { ...formData.item_stats, grants_ability: e.target.value } })}
                    className="bg-bg-1 border-border h-8 text-sm" placeholder="Ability name" />
                </div>
              )}
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
                className="bg-gradient-to-r from-[#F2B880] to-[#DA77F2] hover:from-[#DA77F2] hover:to-[#F2B880] text-bg-0 font-semibold px-8"
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
