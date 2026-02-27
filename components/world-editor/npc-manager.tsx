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
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Plus, Edit, Trash2, Upload, X, Sword, Shield, Heart, Zap } from 'lucide-react'
import Image from 'next/image'

interface DcThresholds {
  combat?: number | null
  persuasion?: number | null
  chaos?: number | null
  charm?: number | null
  wit?: number | null
}

interface CombatStats {
  hp: number
  max_hp: number
  mp: number
  max_mp: number
  attack: number
  defense: number
  is_hostile: boolean
  dc_thresholds?: DcThresholds
}

const DEFAULT_COMBAT_STATS: CombatStats = {
  hp: 10, max_hp: 10, mp: 0, max_mp: 0, attack: 2, defense: 0, is_hostile: false,
}

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

interface WorldItem {
  id: string
  name: string
  item_stats: Record<string, unknown> | null
}

interface EquipmentSlotData {
  itemId: string | null
  itemName: string
  droppable: boolean
}

const SLOT_LABELS: Record<string, string> = {
  weapon_1: '主手武器', weapon_2: '副手武器',
  armor_head: '头盔', armor_chest: '胸甲', armor_legs: '腿甲',
  accessory_1: '饰品1', accessory_2: '饰品2', accessory_3: '饰品3', accessory_4: '饰品4',
}

const EMPTY_SLOTS: Record<string, EquipmentSlotData> = Object.fromEntries(
  Object.keys(SLOT_LABELS).map(k => [k, { itemId: null, itemName: '', droppable: false }])
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

interface NPC {
  id: string
  world_id: string
  name: string
  aliases: string[] | null
  description: string
  personality: string | null
  motivations: string | null
  image_url: string | null
  combat_stats: CombatStats | null
  created_at: string
  updated_at: string
}

interface NPCManagerProps {
  worldId: string
}

export function NPCManager({ worldId }: NPCManagerProps) {
  const supabase = createClient()
  const [npcs, setNpcs] = useState<NPC[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedNPC, setSelectedNPC] = useState<NPC | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    aliases: '',
    description: '',
    personality: '',
    motivations: '',
    image_url: null as string | null,
    combat_stats: { ...DEFAULT_COMBAT_STATS } as CombatStats,
  })

  // World abilities for NPC ability linking
  const [worldAbilities, setWorldAbilities] = useState<WorldAbility[]>([])
  const [linkedAbilityIds, setLinkedAbilityIds] = useState<Set<string>>(new Set())

  // World taxonomies for NPC taxonomy linking
  const [worldTaxonomies, setWorldTaxonomies] = useState<WorldTaxonomy[]>([])
  const [linkedTaxonomyIds, setLinkedTaxonomyIds] = useState<Set<string>>(new Set())

  // World organizations for NPC organization linking
  const [worldOrganizations, setWorldOrganizations] = useState<WorldOrganization[]>([])
  const [linkedOrganizationIds, setLinkedOrganizationIds] = useState<Set<string>>(new Set())

  // Droppable abilities — abilities that drop when NPC is defeated
  const [droppableAbilityIds, setDroppableAbilityIds] = useState<Set<string>>(new Set())

  // World items for NPC item linking (non-equipment) + equipment
  const [linkedItemIds, setLinkedItemIds] = useState<Set<string>>(new Set())
  const [worldItems, setWorldItems] = useState<WorldItem[]>([])
  const [equipmentSlots, setEquipmentSlots] = useState<Record<string, EquipmentSlotData>>({ ...EMPTY_SLOTS })

  const fetchNPCs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('npcs')
        .select('*')
        .eq('world_id', worldId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setNpcs(data || [])
    } catch {
      toast.error('Failed to load NPCs')
    } finally {
      setLoading(false)
    }
  }, [supabase, worldId])

  const fetchWorldAbilities = useCallback(async () => {
    const { data } = await supabase
      .from('abilities')
      .select('id, name, description')
      .eq('world_id', worldId)
      .order('name')
    setWorldAbilities(data ?? [])
  }, [supabase, worldId])

  const fetchLinkedAbilities = useCallback(async (npcId: string) => {
    const { data } = await supabase
      .from('npc_abilities')
      .select('ability_id, droppable')
      .eq('npc_id', npcId)
    const rows = (data ?? []) as Array<{ ability_id: string; droppable: boolean }>
    setLinkedAbilityIds(new Set(rows.map(r => r.ability_id)))
    setDroppableAbilityIds(new Set(rows.filter(r => r.droppable).map(r => r.ability_id)))
  }, [supabase])

  const fetchWorldTaxonomies = useCallback(async () => {
    const { data } = await supabase
      .from('taxonomies')
      .select('id, name, description')
      .eq('world_id', worldId)
      .order('name')
    setWorldTaxonomies((data ?? []) as WorldTaxonomy[])
  }, [supabase, worldId])

  const fetchWorldOrganizations = useCallback(async () => {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, description')
      .eq('world_id', worldId)
      .order('name')
    setWorldOrganizations((data ?? []) as WorldOrganization[])
  }, [supabase, worldId])

  const fetchLinkedTaxonomies = useCallback(async (npcId: string) => {
    const { data } = await supabase
      .from('npc_taxonomies')
      .select('taxonomy_id')
      .eq('npc_id', npcId)
    setLinkedTaxonomyIds(new Set((data ?? []).map(r => r.taxonomy_id)))
  }, [supabase])

  const fetchLinkedOrganizations = useCallback(async (npcId: string) => {
    const { data } = await supabase
      .from('npc_organizations')
      .select('organization_id')
      .eq('npc_id', npcId)
    setLinkedOrganizationIds(new Set((data ?? []).map(r => r.organization_id)))
  }, [supabase])

  const fetchLinkedItems = useCallback(async (npcId: string) => {
    const { data } = await supabase
      .from('npc_items')
      .select('item_id')
      .eq('npc_id', npcId)
    setLinkedItemIds(new Set((data ?? []).map(r => r.item_id)))
  }, [supabase])

  const fetchWorldItems = useCallback(async () => {
    const { data } = await supabase
      .from('items')
      .select('id, name, item_stats')
      .eq('world_id', worldId)
      .order('name')
    setWorldItems((data ?? []) as WorldItem[])
  }, [supabase, worldId])

  const fetchEquipment = useCallback(async (npcId: string) => {
    const { data } = await supabase
      .from('npc_equipment')
      .select('item_id, item_name, slot_type, droppable')
      .eq('npc_id', npcId)
    const slots = { ...EMPTY_SLOTS }
    for (const row of (data ?? []) as { item_id: string; item_name: string; slot_type: string; droppable: boolean }[]) {
      slots[row.slot_type] = { itemId: row.item_id, itemName: row.item_name, droppable: !!row.droppable }
    }
    setEquipmentSlots(slots)
  }, [supabase])

  useEffect(() => {
    fetchNPCs()
    fetchWorldAbilities()
    fetchWorldItems()
    fetchWorldTaxonomies()
    fetchWorldOrganizations()
  }, [fetchNPCs, fetchWorldAbilities, fetchWorldItems, fetchWorldTaxonomies, fetchWorldOrganizations])

  const handleAdd = () => {
    setFormData({
      name: '',
      aliases: '',
      description: '',
      personality: '',
      motivations: '',
      image_url: null,
      combat_stats: { ...DEFAULT_COMBAT_STATS },
    })
    setLinkedAbilityIds(new Set())
    setDroppableAbilityIds(new Set())
    setLinkedTaxonomyIds(new Set())
    setLinkedOrganizationIds(new Set())
    setLinkedItemIds(new Set())
    setEquipmentSlots({ ...EMPTY_SLOTS })
    setSelectedNPC(null)
    setIsEditing(true)
  }

  const handleEdit = (npc: NPC) => {
    setFormData({
      name: npc.name,
      aliases: npc.aliases?.join(', ') || '',
      description: npc.description,
      personality: npc.personality || '',
      motivations: npc.motivations || '',
      image_url: npc.image_url,
      combat_stats: npc.combat_stats ? { ...npc.combat_stats } : { ...DEFAULT_COMBAT_STATS },
    })
    setSelectedNPC(npc)
    if (npc.id) {
      fetchLinkedAbilities(npc.id)
      fetchLinkedTaxonomies(npc.id)
      fetchLinkedOrganizations(npc.id)
      fetchLinkedItems(npc.id)
      fetchEquipment(npc.id)
    }
    setIsEditing(true)
  }

  const handleImageUpload = async (file: File) => {
    setUploading(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${worldId}-npc-${Date.now()}.${fileExt}`
      const filePath = `npc-images/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('world-assets')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const {
        data: { publicUrl },
      } = supabase.storage.from('world-assets').getPublicUrl(filePath)

      setFormData({ ...formData, image_url: publicUrl })
      toast.success('Image uploaded successfully')
    } catch {
      toast.error('Failed to upload image')
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.description.trim()) {
      toast.error('Name and description are required')
      return
    }

    setSaving(true)
    try {
      // Generate embedding for the NPC
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
          additionalContext: [formData.personality, formData.motivations]
            .filter(Boolean)
            .join(' '),
        }),
      })

      if (!embeddingResponse.ok) {
        throw new Error('Failed to generate embedding')
      }

      const { embedding } = await embeddingResponse.json()

      const npcData = {
        world_id: worldId,
        name: formData.name.trim(),
        aliases: formData.aliases
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        description: formData.description.trim(),
        personality: formData.personality.trim() || null,
        motivations: formData.motivations.trim() || null,
        image_url: formData.image_url,
        combat_stats: formData.combat_stats,
        embedding, // Include the generated embedding
      }

      let npcId: string | null = null
      if (selectedNPC) {
        const { error } = await supabase
          .from('npcs')
          .update(npcData)
          .eq('id', selectedNPC.id)

        if (error) throw error
        npcId = selectedNPC.id
        toast.success('NPC updated successfully')
      } else {
        const { data: inserted, error } = await supabase.from('npcs').insert(npcData).select('id').single()

        if (error) throw error
        npcId = inserted.id
        toast.success('NPC created successfully')
      }

      // Sync NPC ability links (with droppable flag)
      if (npcId) {
        await supabase.from('npc_abilities').delete().eq('npc_id', npcId)
        if (linkedAbilityIds.size > 0) {
          const links = Array.from(linkedAbilityIds).map(aid => ({
            npc_id: npcId!,
            ability_id: aid,
            droppable: droppableAbilityIds.has(aid),
          }))
          await supabase.from('npc_abilities').insert(links)
        }

        // Sync NPC taxonomy links
        await supabase.from('npc_taxonomies').delete().eq('npc_id', npcId)
        if (linkedTaxonomyIds.size > 0) {
          const links = Array.from(linkedTaxonomyIds).map(tid => ({ npc_id: npcId!, taxonomy_id: tid }))
          await supabase.from('npc_taxonomies').insert(links)
        }

        // Sync NPC organization links
        await supabase.from('npc_organizations').delete().eq('npc_id', npcId)
        if (linkedOrganizationIds.size > 0) {
          const links = Array.from(linkedOrganizationIds).map(oid => ({ npc_id: npcId!, organization_id: oid }))
          await supabase.from('npc_organizations').insert(links)
        }

        // Sync NPC item links
        await supabase.from('npc_items').delete().eq('npc_id', npcId)
        if (linkedItemIds.size > 0) {
          const links = Array.from(linkedItemIds).map(iid => ({ npc_id: npcId!, item_id: iid }))
          await supabase.from('npc_items').insert(links)
        }

        // Sync NPC equipment (with droppable flag)
        await supabase.from('npc_equipment').delete().eq('npc_id', npcId)
        const equipRows = Object.entries(equipmentSlots)
          .filter(([, slot]) => slot.itemId)
          .map(([slotType, slot]) => ({
            npc_id: npcId!,
            item_id: slot.itemId,
            item_name: slot.itemName,
            slot_type: slotType,
            droppable: slot.droppable,
          }))
        if (equipRows.length > 0) {
          await supabase.from('npc_equipment').insert(equipRows)
        }
      }

      await fetchNPCs()
      setIsEditing(false)
    } catch (error) {
      console.error('Save error:', error)
      toast.error('Failed to save NPC')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this NPC?')) return

    try {
      const { error } = await supabase.from('npcs').delete().eq('id', id)

      if (error) throw error

      toast.success('NPC deleted successfully')
      await fetchNPCs()
    } catch {
      toast.error('Failed to delete NPC')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-fg-1">Manage non-player characters in this world</p>
        <Button
          onClick={handleAdd}
          className="bg-gradient-to-r from-[#DA77F2] to-[#6EE7F2] hover:from-[#6EE7F2] hover:to-[#DA77F2] text-bg-0 font-semibold"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add NPC
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-fg-1">
          <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-75" />
          <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse delay-150" />
          Loading NPCs...
        </div>
      ) : npcs.length === 0 ? (
        <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#DA77F2]/20 p-12 text-center">
          <p className="text-fg-1 mb-4">No NPCs yet.</p>
          <p className="text-[#DA77F2]">Add your first NPC to get started!</p>
        </Card>
      ) : (
        <div className="space-y-px">
          <AnimatePresence>
            {npcs.map((npc, index) => (
              <motion.div
                key={npc.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: index * 0.02 }}
                className="bg-gradient-to-r from-bg-1 to-bg-2 border-b border-border hover:bg-bg-2/50 transition-colors group"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0 flex items-center gap-4">
                    <span className="text-fg-0 font-medium w-48 truncate">{npc.name}</span>
                    <span className="text-[#DA77F2] text-sm w-64 truncate">
                      {npc.aliases?.join(', ') || '—'}
                    </span>
                    <span className="text-fg-1 text-sm flex-1 truncate">
                      {npc.description}
                    </span>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(npc)}
                      className="p-2 hover:bg-[#6EE7F2]/10 rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4 text-[#6EE7F2]" />
                    </button>
                    <button
                      onClick={() => handleDelete(npc.id)}
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
        <DialogContent className="bg-bg-0 border-[#DA77F2]/30 max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#DA77F2] to-[#6EE7F2] bg-clip-text text-transparent">
              {selectedNPC ? 'Edit NPC' : 'New NPC'}
            </DialogTitle>

            {/* Image Upload */}
            <div className="space-y-2">
              <Label className="text-[#DA77F2] font-semibold">Character Portrait</Label>
              {formData.image_url ? (
                <div className="relative h-48 rounded-xl overflow-hidden">
                  <Image
                    src={formData.image_url}
                    alt="NPC portrait"
                    fill
                    className="object-cover"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute top-2 right-2 bg-bg-0/80 border-red-500/30 hover:border-red-500"
                    onClick={() => setFormData({ ...formData, image_url: null })}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-[#DA77F2]/50 transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    id="npc-image"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleImageUpload(file)
                    }}
                  />
                  <label htmlFor="npc-image" className="cursor-pointer">
                    <Upload className="w-8 h-8 mx-auto mb-2 text-[#DA77F2]" />
                    <p className="text-fg-1 text-sm">
                      {uploading ? 'Uploading...' : 'Click to upload image'}
                    </p>
                  </label>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name" className="text-[#6EE7F2] font-semibold">
                Name *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#6EE7F2]"
                placeholder="Character name"
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
                rows={4}
                placeholder="Physical appearance, background, etc."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="personality" className="text-[#6EE7F2] font-semibold">
                Personality
              </Label>
              <Textarea
                id="personality"
                value={formData.personality}
                onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#6EE7F2]"
                rows={3}
                placeholder="Character traits, mannerisms, etc."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="motivations" className="text-[#DA77F2] font-semibold">
                Motivations
              </Label>
              <Textarea
                id="motivations"
                value={formData.motivations}
                onChange={(e) => setFormData({ ...formData, motivations: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#DA77F2]"
                rows={3}
                placeholder="Goals, desires, fears, etc."
              />
            </div>

            {/* Combat Stats */}
            <div className="space-y-3 p-4 bg-bg-2 rounded-xl border border-red-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Sword className="w-4 h-4 text-red-400" />
                <Label className="text-red-400 font-semibold">Combat Stats</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-fg-1 flex items-center gap-1"><Heart className="w-3 h-3 text-red-400" /> HP</Label>
                  <Input type="number" value={formData.combat_stats.max_hp}
                    onChange={(e) => { const v = Number(e.target.value); setFormData({ ...formData, combat_stats: { ...formData.combat_stats, hp: v, max_hp: v } }) }}
                    className="bg-bg-1 border-border h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-fg-1 flex items-center gap-1"><Zap className="w-3 h-3 text-blue-400" /> MP</Label>
                  <Input type="number" value={formData.combat_stats.max_mp}
                    onChange={(e) => { const v = Number(e.target.value); setFormData({ ...formData, combat_stats: { ...formData.combat_stats, mp: v, max_mp: v } }) }}
                    className="bg-bg-1 border-border h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-fg-1 flex items-center gap-1"><Sword className="w-3 h-3 text-orange-400" /> Attack</Label>
                  <Input type="number" value={formData.combat_stats.attack}
                    onChange={(e) => setFormData({ ...formData, combat_stats: { ...formData.combat_stats, attack: Number(e.target.value) } })}
                    className="bg-bg-1 border-border h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-fg-1 flex items-center gap-1"><Shield className="w-3 h-3 text-cyan-400" /> Defense</Label>
                  <Input type="number" value={formData.combat_stats.defense}
                    onChange={(e) => setFormData({ ...formData, combat_stats: { ...formData.combat_stats, defense: Number(e.target.value) } })}
                    className="bg-bg-1 border-border h-8 text-sm" />
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <div>
                  <Label className="text-xs text-fg-1">Hostile</Label>
                  <p className="text-[10px] text-fg-1/60">Attacks player on contact</p>
                </div>
                <Switch checked={formData.combat_stats.is_hostile}
                  onCheckedChange={(v) => setFormData({ ...formData, combat_stats: { ...formData.combat_stats, is_hostile: v } })} />
              </div>

              {/* DC Thresholds */}
              <div className="pt-3 mt-3 border-t border-border">
                <Label className="text-xs text-fg-1 font-semibold">DC Thresholds</Label>
                <p className="text-[10px] text-fg-1/60 mb-2">Override AI-determined DC for dice checks against this NPC. Empty = AI decides.</p>
                <div className="grid grid-cols-5 gap-2">
                  {([
                    ['combat', 'Combat'],
                    ['persuasion', 'Persuasion'],
                    ['chaos', 'Chaos'],
                    ['charm', 'Charm'],
                    ['wit', 'Wit'],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-[10px] text-fg-1/80">{label}</Label>
                      <Input
                        type="number"
                        value={formData.combat_stats.dc_thresholds?.[key] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? null : Number(e.target.value)
                          setFormData({
                            ...formData,
                            combat_stats: {
                              ...formData.combat_stats,
                              dc_thresholds: {
                                ...formData.combat_stats.dc_thresholds,
                                [key]: val,
                              },
                            },
                          })
                        }}
                        className="bg-bg-1 border-border h-7 text-xs"
                        placeholder="AI"
                        min={1}
                        max={50}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* NPC Abilities */}
            {worldAbilities.length > 0 && (
              <div className="space-y-3 p-4 bg-bg-2 rounded-xl border border-[#6EE7F2]/20">
                <Label className="text-[#6EE7F2] font-semibold">Known Abilities</Label>
                <p className="text-[10px] text-fg-1/60">Select which abilities this NPC can use in combat</p>
                <div className="flex flex-wrap gap-2">
                  {worldAbilities.map((ab) => {
                    const isLinked = linkedAbilityIds.has(ab.id)
                    return (
                      <div key={ab.id} className="flex items-center gap-1">
                        <button type="button"
                          onClick={() => {
                            const next = new Set(linkedAbilityIds)
                            if (next.has(ab.id)) {
                              next.delete(ab.id)
                              const nextDrop = new Set(droppableAbilityIds)
                              nextDrop.delete(ab.id)
                              setDroppableAbilityIds(nextDrop)
                            } else {
                              next.add(ab.id)
                            }
                            setLinkedAbilityIds(next)
                          }}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                            isLinked
                              ? 'bg-[#6EE7F2]/20 border-[#6EE7F2]/50 text-[#6EE7F2]'
                              : 'bg-bg-1 border-border text-fg-1 hover:border-[#6EE7F2]/30'
                          }`}
                          title={ab.description}
                        >
                          {ab.name}
                        </button>
                        {isLinked && (
                          <label className="flex items-center gap-1 cursor-pointer" title="Drops when NPC is defeated">
                            <input
                              type="checkbox"
                              checked={droppableAbilityIds.has(ab.id)}
                              onChange={(e) => {
                                const next = new Set(droppableAbilityIds)
                                if (e.target.checked) next.add(ab.id); else next.delete(ab.id)
                                setDroppableAbilityIds(next)
                              }}
                              className="accent-[#6EE7F2] w-3 h-3"
                            />
                            <span className="text-[10px] text-fg-1/60">Drop</span>
                          </label>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Equipment Slots */}
            <div className="space-y-3 p-4 bg-bg-2 rounded-xl border border-[#F2B880]/20">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-[#F2B880]" />
                <Label className="text-[#F2B880] font-semibold">Equipment Slots</Label>
              </div>
              <p className="text-[10px] text-fg-1/60">Assign items from this world to NPC equipment slots</p>
              <div className="space-y-2">
                {Object.entries(SLOT_LABELS).map(([slotType, label]) => {
                  const available = getItemsForSlot(worldItems, slotType)
                  const slotData = equipmentSlots[slotType]
                  return (
                    <div key={slotType} className="flex items-center gap-3">
                      <span className="text-xs text-fg-1 w-20 text-right flex-shrink-0">{label}</span>
                      <select
                        value={slotData?.itemId ?? ''}
                        onChange={(e) => {
                          const itemId = e.target.value || null
                          const item = worldItems.find(i => i.id === itemId)
                          setEquipmentSlots({
                            ...equipmentSlots,
                            [slotType]: { itemId, itemName: item?.name ?? '', droppable: slotData?.droppable ?? false },
                          })
                        }}
                        className="flex-1 bg-bg-1 border border-border rounded-md px-3 py-1.5 text-sm text-fg-0 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]"
                      >
                        <option value="">None</option>
                        {available.map(item => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      {slotData?.itemId && (
                        <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer" title="Drops when NPC is defeated">
                          <input
                            type="checkbox"
                            checked={slotData.droppable}
                            onChange={(e) => {
                              setEquipmentSlots({
                                ...equipmentSlots,
                                [slotType]: { ...slotData, droppable: e.target.checked },
                              })
                            }}
                            className="accent-[#F2B880] w-3.5 h-3.5"
                          />
                          <span className="text-[10px] text-fg-1/60">Droppable</span>
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
              {worldItems.length === 0 && (
                <p className="text-[10px] text-fg-1/40">No items in this world yet. Create items in the Items tab first.</p>
              )}
            </div>

            {/* Taxonomies */}
            {worldTaxonomies.length > 0 && (
              <div className="space-y-3 p-4 bg-bg-2 rounded-xl border border-[#DA77F2]/20">
                <Label className="text-[#DA77F2] font-semibold">Taxonomies</Label>
                <p className="text-[10px] text-fg-1/60">Race, species, or classification tags for this NPC</p>
                <div className="flex flex-wrap gap-2">
                  {worldTaxonomies.map((tax) => (
                    <button key={tax.id} type="button"
                      onClick={() => {
                        const next = new Set(linkedTaxonomyIds)
                        if (next.has(tax.id)) next.delete(tax.id); else next.add(tax.id)
                        setLinkedTaxonomyIds(next)
                      }}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        linkedTaxonomyIds.has(tax.id)
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

            {/* Organizations */}
            {worldOrganizations.length > 0 && (
              <div className="space-y-3 p-4 bg-bg-2 rounded-xl border border-[#F2B880]/20">
                <Label className="text-[#F2B880] font-semibold">Organizations</Label>
                <p className="text-[10px] text-fg-1/60">Factions, guilds, or groups this NPC belongs to</p>
                <div className="flex flex-wrap gap-2">
                  {worldOrganizations.map((org) => (
                    <button key={org.id} type="button"
                      onClick={() => {
                        const next = new Set(linkedOrganizationIds)
                        if (next.has(org.id)) next.delete(org.id); else next.add(org.id)
                        setLinkedOrganizationIds(next)
                      }}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        linkedOrganizationIds.has(org.id)
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

            {/* Associated Items */}
            {worldItems.length > 0 && (
              <div className="space-y-3 p-4 bg-bg-2 rounded-xl border border-green-500/20">
                <Label className="text-green-400 font-semibold">Associated Items</Label>
                <p className="text-[10px] text-fg-1/60">Items this NPC carries, sells, or is known for (separate from equipment slots)</p>
                <div className="flex flex-wrap gap-2">
                  {worldItems.map((item) => (
                    <button key={item.id} type="button"
                      onClick={() => {
                        const next = new Set(linkedItemIds)
                        if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
                        setLinkedItemIds(next)
                      }}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                        linkedItemIds.has(item.id)
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
                className="bg-gradient-to-r from-[#DA77F2] to-[#6EE7F2] hover:from-[#6EE7F2] hover:to-[#DA77F2] text-bg-0 font-semibold px-8"
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
