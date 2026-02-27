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
import { Plus, Edit, Trash2, Zap, Flame, Sparkles } from 'lucide-react'

type EffectType = 'spell' | 'passive' | 'active' | 'toggle' | ''

interface AbilityStats {
  mp_cost: number
  damage: number
  hp_restore: number
  effect_type: EffectType
  acquisition_dc?: number
}

interface Ability {
  id: string
  name: string
  aliases: string[]
  description: string
  ability_stats: AbilityStats | null
  [key: string]: unknown
}

interface AbilityManagerProps {
  worldId: string
}

const DEFAULT_ABILITY_STATS: AbilityStats = {
  mp_cost: 0, damage: 0, hp_restore: 0, effect_type: '',
}

export function AbilityManager({ worldId }: AbilityManagerProps) {
  const supabase = createClient()
  const [entities, setEntities] = useState<Ability[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEntity, setSelectedEntity] = useState<Ability | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    aliases: '',
    description: '',
    ability_stats: { ...DEFAULT_ABILITY_STATS } as AbilityStats,
  })

  const fetchEntities = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('abilities')
        .select('*')
        .eq('world_id', worldId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setEntities(data || [])
    } catch {
      toast.error('Failed to load abilities')
    } finally {
      setLoading(false)
    }
  }, [supabase, worldId])

  useEffect(() => {
    fetchEntities()
  }, [fetchEntities])

  const handleAdd = () => {
    setFormData({ name: '', aliases: '', description: '', ability_stats: { ...DEFAULT_ABILITY_STATS } })
    setSelectedEntity(null)
    setIsEditing(true)
  }

  const handleEdit = (entity: Ability) => {
    setFormData({
      name: entity.name,
      aliases: entity.aliases?.join(', ') || '',
      description: entity.description,
      ability_stats: entity.ability_stats ? { ...entity.ability_stats } : { ...DEFAULT_ABILITY_STATS },
    })
    setSelectedEntity(entity)
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.description.trim()) {
      toast.error('Name and description are required')
      return
    }

    setSaving(true)
    try {
      const embeddingResponse = await fetch('/api/generate-embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim(),
          aliases: formData.aliases.split(',').map((a) => a.trim()).filter(Boolean),
        }),
      })

      if (!embeddingResponse.ok) throw new Error('Failed to generate embedding')
      const { embedding } = await embeddingResponse.json()

      const entityData = {
        world_id: worldId,
        name: formData.name.trim(),
        aliases: formData.aliases.split(',').map((a) => a.trim()).filter(Boolean),
        description: formData.description.trim(),
        ability_stats: formData.ability_stats.effect_type ? formData.ability_stats : {},
        embedding,
      }

      if (selectedEntity) {
        const { error } = await supabase.from('abilities').update(entityData).eq('id', selectedEntity.id)
        if (error) throw error
        toast.success('Ability updated successfully')
      } else {
        const { error } = await supabase.from('abilities').insert(entityData)
        if (error) throw error
        toast.success('Ability created successfully')
      }

      await fetchEntities()
      setIsEditing(false)
    } catch (error) {
      console.error('Save error:', error)
      toast.error('Failed to save ability')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this ability?')) return
    try {
      const { error } = await supabase.from('abilities').delete().eq('id', id)
      if (error) throw error
      toast.success('Ability deleted successfully')
      await fetchEntities()
    } catch {
      toast.error('Failed to delete ability')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-fg-1">Manage abilities and powers in this world</p>
        <Button onClick={handleAdd}
          className="bg-gradient-to-r from-[#6EE7F2] to-[#DA77F2] hover:from-[#DA77F2] hover:to-[#6EE7F2] text-bg-0 font-semibold">
          <Plus className="w-4 h-4 mr-2" />
          Add Ability
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-fg-1">
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse delay-75" />
          <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse delay-150" />
          Loading abilities...
        </div>
      ) : entities.length === 0 ? (
        <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#6EE7F2]/20 p-12 text-center">
          <p className="text-fg-1 mb-4">No abilities yet.</p>
          <p className="text-[#6EE7F2]">Add your first ability to get started!</p>
        </Card>
      ) : (
        <div className="space-y-px">
          <AnimatePresence>
            {entities.map((entity, index) => {
              const stats = entity.ability_stats
              const badge = stats?.effect_type
                ? `${stats.effect_type}${stats.damage ? ` DMG:${stats.damage}` : ''}${stats.hp_restore && stats.hp_restore > 0 ? ` HEAL:${stats.hp_restore}` : ''}${stats.hp_restore && stats.hp_restore < 0 ? ` DRAIN:${Math.abs(stats.hp_restore)}` : ''}${stats.mp_cost ? ` MP:${stats.mp_cost}` : ''}`
                : null
              return (
                <motion.div key={entity.id}
                  initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }} transition={{ delay: index * 0.02 }}
                  className="bg-gradient-to-r from-bg-1 to-bg-2 border-b border-border hover:bg-bg-2/50 transition-colors group">
                  <div className="flex items-center gap-4 p-4">
                    <div className="flex-1 min-w-0 flex items-center gap-4">
                      <span className="text-fg-0 font-medium w-48 truncate">{entity.name}</span>
                      {badge && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#6EE7F2]/10 text-[#6EE7F2] border border-[#6EE7F2]/20 whitespace-nowrap">
                          {badge}
                        </span>
                      )}
                      <span className="text-fg-1 text-sm flex-1 truncate">{entity.description}</span>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(entity)} className="p-2 hover:bg-[#6EE7F2]/10 rounded-lg transition-colors">
                        <Edit className="w-4 h-4 text-[#6EE7F2]" />
                      </button>
                      <button onClick={() => handleDelete(entity.id)} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="bg-bg-0 border-[#6EE7F2]/30 max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#6EE7F2] to-[#DA77F2] bg-clip-text text-transparent">
              {selectedEntity ? 'Edit Ability' : 'New Ability'}
            </DialogTitle>

            <div className="space-y-2">
              <Label htmlFor="name" className="text-[#6EE7F2] font-semibold">Name *</Label>
              <Input id="name" value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#6EE7F2]" placeholder="Ability name" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aliases" className="text-[#DA77F2] font-semibold">Aliases</Label>
              <Input id="aliases" value={formData.aliases}
                onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#DA77F2]" placeholder="Comma-separated aliases" />
              {formData.aliases && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.aliases.split(',').map((a) => a.trim()).filter(Boolean).map((alias, i) => (
                    <span key={i} className="px-2 py-1 bg-[#DA77F2]/20 text-[#DA77F2] text-xs rounded-lg border border-[#DA77F2]/30">
                      {alias}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-[#F2B880] font-semibold">Description *</Label>
              <Textarea id="description" value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#F2B880]" rows={4}
                placeholder="What this ability does, visual effects, lore..." />
            </div>

            {/* Ability Stats */}
            <div className="space-y-3 p-4 bg-bg-2 rounded-xl border border-[#6EE7F2]/20">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-[#6EE7F2]" />
                <Label className="text-[#6EE7F2] font-semibold">Ability Mechanics</Label>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-fg-1">Effect Type</Label>
                <select value={formData.ability_stats.effect_type}
                  onChange={(e) => setFormData({ ...formData, ability_stats: { ...formData.ability_stats, effect_type: e.target.value as EffectType } })}
                  className="w-full bg-bg-1 border border-border rounded-md px-3 py-1.5 text-sm text-fg-0 [&>option]:bg-[#1a1a2e] [&>option]:text-[#e0e0e0]">
                  <option value="">None</option>
                  <option value="spell">Spell (active cast, costs MP)</option>
                  <option value="active">Active (physical skill)</option>
                  <option value="passive">Passive (always on)</option>
                  <option value="toggle">Toggle (on/off)</option>
                </select>
              </div>
              {formData.ability_stats.effect_type && formData.ability_stats.effect_type !== 'passive' && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-fg-1 flex items-center gap-1"><Zap className="w-3 h-3 text-blue-400" /> MP Cost</Label>
                    <Input type="number" value={formData.ability_stats.mp_cost}
                      onChange={(e) => setFormData({ ...formData, ability_stats: { ...formData.ability_stats, mp_cost: Number(e.target.value) } })}
                      className="bg-bg-1 border-border h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-fg-1 flex items-center gap-1"><Flame className="w-3 h-3 text-orange-400" /> Damage</Label>
                    <Input type="number" value={formData.ability_stats.damage}
                      onChange={(e) => setFormData({ ...formData, ability_stats: { ...formData.ability_stats, damage: Number(e.target.value) } })}
                      className="bg-bg-1 border-border h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-fg-1">HP Effect</Label>
                    <Input type="number" value={formData.ability_stats.hp_restore}
                      onChange={(e) => setFormData({ ...formData, ability_stats: { ...formData.ability_stats, hp_restore: Number(e.target.value) } })}
                      className="bg-bg-1 border-border h-8 text-sm" placeholder="正=治疗 负=吸血" />
                    <p className="text-[10px] text-fg-1/50">正值治疗，负值吸取HP（无视DEF）</p>
                  </div>
                </div>
              )}
              <div className="pt-3 mt-2 border-t border-border/50">
                <div className="space-y-1">
                  <Label className="text-xs text-fg-1">Acquisition DC</Label>
                  <Input type="number" value={formData.ability_stats.acquisition_dc ?? ''}
                    onChange={(e) => setFormData({ ...formData, ability_stats: { ...formData.ability_stats, acquisition_dc: e.target.value === '' ? undefined : Number(e.target.value) } })}
                    className="bg-bg-1 border-border h-8 text-sm w-32" placeholder="0" min={0} max={50} />
                  <p className="text-[10px] text-fg-1/50">Extra DC added when a player tries to learn this ability from an NPC (stacks with NPC&apos;s Persuasion DC)</p>
                </div>
              </div>
            </div>

            <div className="flex gap-4 justify-end pt-4">
              <button onClick={() => setIsEditing(false)} className="text-fg-1 hover:text-fg-0 transition-colors">Cancel</button>
              <Button onClick={handleSave} disabled={saving}
                className="bg-gradient-to-r from-[#6EE7F2] to-[#DA77F2] hover:from-[#DA77F2] hover:to-[#6EE7F2] text-bg-0 font-semibold px-8">
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
