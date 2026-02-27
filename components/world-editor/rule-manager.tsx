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
import { Plus, Edit, Trash2, AlertCircle } from 'lucide-react'

interface Rule {
  id: string
  world_id: string
  name: string
  aliases: string[] | null
  description: string
  priority: boolean
  created_at: string
  updated_at: string
}

interface RuleManagerProps{
  worldId: string
}

export function RuleManager({ worldId }: RuleManagerProps) {
  const supabase = createClient()
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    aliases: '',
    description: '',
    priority: true,
  })

  const fetchRules = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('rules')
        .select('*')
        .eq('world_id', worldId)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      setRules(data || [])
    } catch {
      toast.error('Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [supabase, worldId])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  const handleAdd = () => {
    setFormData({
      name: '',
      aliases: '',
      description: '',
      priority: true,
    })
    setSelectedRule(null)
    setIsEditing(true)
  }

  const handleEdit = (rule: Rule) => {
    setFormData({
      name: rule.name,
      aliases: rule.aliases?.join(', ') || '',
      description: rule.description,
      priority: rule.priority,
    })
    setSelectedRule(rule)
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.description.trim()) {
      toast.error('Name and description are required')
      return
    }

    setSaving(true)
    try {
      // Generate embedding for the rule
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

      const ruleData = {
        world_id: worldId,
        name: formData.name.trim(),
        aliases: formData.aliases
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        description: formData.description.trim(),
        priority: formData.priority,
        embedding, // Include the generated embedding
      }

      if (selectedRule) {
        const { error } = await supabase
          .from('rules')
          .update(ruleData)
          .eq('id', selectedRule.id)

        if (error) throw error
        toast.success('Rule updated successfully')
      } else {
        const { error } = await supabase.from('rules').insert(ruleData)

        if (error) throw error
        toast.success('Rule created successfully')
      }

      await fetchRules()
      setIsEditing(false)
    } catch (error) {
      console.error('Save error:', error)
      toast.error('Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return

    try {
      const { error } = await supabase.from('rules').delete().eq('id', id)

      if (error) throw error

      toast.success('Rule deleted successfully')
      await fetchRules()
    } catch {
      toast.error('Failed to delete rule')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-fg-1">Define the rules and mechanics of this world</p>
        <Button
          onClick={handleAdd}
          className="bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] hover:from-[#F2B880] hover:to-[#6EE7F2] text-bg-0 font-semibold"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Rule
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-fg-1">
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse delay-75" />
          <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse delay-150" />
          Loading rules...
        </div>
      ) : rules.length === 0 ? (
        <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#6EE7F2]/20 p-12 text-center">
          <p className="text-fg-1 mb-4">No rules yet.</p>
          <p className="text-[#6EE7F2]">Add your first rule to get started!</p>
        </Card>
      ) : (
        <div className="space-y-px">
          <AnimatePresence>
            {rules.map((rule, index) => (
              <motion.div
                key={rule.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: index * 0.02 }}
                className="bg-gradient-to-r from-bg-1 to-bg-2 border-b border-border hover:bg-bg-2/50 transition-colors group"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0 flex items-center gap-4">
                    <div className="flex items-center gap-2 w-48">
                      {rule.priority && <AlertCircle className="w-4 h-4 text-[#F2B880] flex-shrink-0" />}
                      <span className="text-fg-0 font-medium truncate">{rule.name}</span>
                    </div>
                    <span className="text-[#6EE7F2] text-sm w-64 truncate">
                      {rule.aliases?.join(', ') || '—'}
                    </span>
                    <span className="text-fg-1 text-sm flex-1 truncate">
                      {rule.description}
                    </span>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(rule)}
                      className="p-2 hover:bg-[#6EE7F2]/10 rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4 text-[#6EE7F2]" />
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
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
        <DialogContent className="bg-bg-0 border-[#6EE7F2]/30 max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] bg-clip-text text-transparent">
              {selectedRule ? 'Edit Rule' : 'New Rule'}
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
                placeholder="Rule name"
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
                placeholder="Describe this rule, its mechanics, and when it applies..."
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-bg-2 rounded-xl border border-border">
              <div className="flex-1">
                <Label htmlFor="priority" className="text-[#F2B880] font-semibold">
                  Priority Rule
                </Label>
                <p className="text-fg-1 text-sm mt-1">
                  Mark as a high-priority rule for AI retrieval
                </p>
              </div>
              <Switch
                id="priority"
                checked={formData.priority}
                onCheckedChange={(checked) => setFormData({ ...formData, priority: checked })}
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
                className="bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] hover:from-[#F2B880] hover:to-[#6EE7F2] text-bg-0 font-semibold px-8"
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
