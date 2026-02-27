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
import { Plus, Edit, Trash2 } from 'lucide-react'

interface Entity {
  id: string
  name: string
  aliases: string[]
  description: string
  [key: string]: unknown
}

interface GenericEntityManagerProps {
  worldId: string
  tableName: 'abilities' | 'organizations' | 'taxonomies'
  entityName: string
  entityNamePlural: string
  accentColor: string
  description: string
}

export function GenericEntityManager({
  worldId,
  tableName,
  entityName,
  entityNamePlural,
  accentColor,
  description,
}: GenericEntityManagerProps) {
  const supabase = createClient()
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    aliases: '',
    description: '',
  })

  const fetchEntities = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('world_id', worldId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setEntities(data || [])
    } catch {
      toast.error(`Failed to load ${entityNamePlural.toLowerCase()}`)
    } finally {
      setLoading(false)
    }
  }, [supabase, tableName, worldId, entityNamePlural])

  useEffect(() => {
    fetchEntities()
  }, [fetchEntities])

  const handleAdd = () => {
    setFormData({
      name: '',
      aliases: '',
      description: '',
    })
    setSelectedEntity(null)
    setIsEditing(true)
  }

  const handleEdit = (entity: Entity) => {
    setFormData({
      name: entity.name,
      aliases: entity.aliases?.join(', ') || '',
      description: entity.description,
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
      // Generate embedding for the entity
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

      const entityData = {
        world_id: worldId,
        name: formData.name.trim(),
        aliases: formData.aliases
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        description: formData.description.trim(),
        embedding, // Include the generated embedding
      }

      if (selectedEntity) {
        const { error } = await supabase
          .from(tableName)
          .update(entityData)
          .eq('id', selectedEntity.id)

        if (error) throw error
        toast.success(`${entityName} updated successfully`)
      } else {
        const { error } = await supabase.from(tableName).insert(entityData)

        if (error) throw error
        toast.success(`${entityName} created successfully`)
      }

      await fetchEntities()
      setIsEditing(false)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[GenericEntityManager · ${tableName}] Save error:`, error)
      toast.error(`Failed to save ${entityName.toLowerCase()}: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`Are you sure you want to delete this ${entityName.toLowerCase()}?`))
      return

    try {
      const { error } = await supabase.from(tableName).delete().eq('id', id)

      if (error) throw error

      toast.success(`${entityName} deleted successfully`)
      await fetchEntities()
    } catch {
      toast.error(`Failed to delete ${entityName.toLowerCase()}`)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-fg-1">{description}</p>
        <Button
          onClick={handleAdd}
          className="bg-gradient-to-r text-bg-0 font-semibold"
          style={{
            backgroundImage: `linear-gradient(to right, ${accentColor}, #6EE7F2)`,
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add {entityName}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-fg-1">
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse delay-75" />
          <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse delay-150" />
          Loading {entityNamePlural.toLowerCase()}...
        </div>
      ) : entities.length === 0 ? (
        <Card
          className="bg-gradient-to-br from-bg-1 to-bg-2 border-opacity-20 p-12 text-center"
          style={{ borderColor: `${accentColor}33` }}
        >
          <p className="text-fg-1 mb-4">No {entityNamePlural.toLowerCase()} yet.</p>
          <p style={{ color: accentColor }}>
            Add your first {entityName.toLowerCase()} to get started!
          </p>
        </Card>
      ) : (
        <div className="space-y-px">
          <AnimatePresence>
            {entities.map((entity, index) => (
              <motion.div
                key={entity.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: index * 0.02 }}
                className="bg-gradient-to-r from-bg-1 to-bg-2 border-b border-border hover:bg-bg-2/50 transition-colors group"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0 flex items-center gap-4">
                    <span className="text-fg-0 font-medium w-48 truncate">{entity.name}</span>
                    <span className="text-sm w-64 truncate" style={{ color: accentColor }}>
                      {entity.aliases?.join(', ') || '—'}
                    </span>
                    <span className="text-fg-1 text-sm flex-1 truncate">
                      {entity.description}
                    </span>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(entity)}
                      className="p-2 hover:bg-[#6EE7F2]/10 rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4 text-[#6EE7F2]" />
                    </button>
                    <button
                      onClick={() => handleDelete(entity.id)}
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
        <DialogContent className="bg-bg-0 border-opacity-30 max-w-2xl max-h-[90vh] overflow-y-auto" style={{ borderColor: `${accentColor}4D` }}>
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(to right, ${accentColor}, #6EE7F2)` }}>
              {selectedEntity ? `Edit ${entityName}` : `New ${entityName}`}
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
                placeholder={`${entityName} name`}
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
                placeholder={`Describe this ${entityName.toLowerCase()}...`}
              />
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
                className="bg-gradient-to-r text-bg-0 font-semibold px-8"
                style={{
                  backgroundImage: `linear-gradient(to right, ${accentColor}, #6EE7F2)`,
                }}
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
