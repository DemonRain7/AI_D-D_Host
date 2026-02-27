'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AppLayout } from '@/components/layout/app-layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Save, Upload, X } from 'lucide-react'
import { Database } from '@/lib/database.types'
import { useAuth } from '@/contexts/auth-context'
import Image from 'next/image'
import { NPCManager } from '@/components/world-editor/npc-manager'
import { ItemManager } from '@/components/world-editor/item-manager'
import { GenericEntityManager } from '@/components/world-editor/generic-entity-manager'
import { AbilityManager } from '@/components/world-editor/ability-manager'
import { RuleManager } from '@/components/world-editor/rule-manager'
import { PlayerFieldsManager } from '@/components/world-editor/player-fields-manager'
import { LocationManager } from '@/components/world-editor/location-manager'
import { StoryGraphManagerWrapper } from '@/components/world-editor/story-graph-manager'

type World = Database['public']['Tables']['worlds']['Row']

export default function WorldEditorPage() {
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  const { user } = useAuth()
  const [world, setWorld] = useState<World | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const fetchWorld = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('worlds')
        .select('*')
        .eq('id', params.id)
        .single()

      if (error) throw error
      setWorld(data)
    } catch {
      toast.error('Failed to load world')
      router.push('/manage')
    } finally {
      setLoading(false)
    }
  }, [params.id, supabase, router])

  useEffect(() => {
    fetchWorld()
  }, [fetchWorld])

  const handleImageUpload = async (file: File) => {
    if (!world) return

    setUploading(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${world.id}-${Date.now()}.${fileExt}`
      const filePath = `world-images/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('world-assets')
        .upload(filePath, file)

      if (uploadError) {
        console.error('Upload error:', uploadError)
        throw uploadError
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from('world-assets').getPublicUrl(filePath)

      // Update local state
      const updatedWorld = { ...world, image_url: publicUrl }
      setWorld(updatedWorld)

      // Automatically save the image URL to the database
      const { error: saveError } = await supabase
        .from('worlds')
        .update({
          image_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', world.id)

      if (saveError) {
        console.error('Save error:', saveError)
        throw saveError
      }

      toast.success('Image uploaded and saved successfully')
    } catch (error: unknown) {
      const pgErr = error as { message?: string; statusCode?: string; error?: string }
      const errorMessage = pgErr?.message || pgErr?.error || (error instanceof Error ? error.message : JSON.stringify(error))
      console.error('Image upload failed:', errorMessage, error)
      toast.error(`Failed to upload image: ${errorMessage}`)
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!world) return

    setSaving(true)
    try {
      // Auto-claim unclaimed worlds on save
      const updatePayload: Record<string, unknown> = {
        name: world.name,
        tone: world.tone,
        setting: world.setting,
        description: world.description,
        starter: world.starter,
        image_url: world.image_url,
        updated_at: new Date().toISOString(),
      }
      if (!world.created_by && user?.id) {
        updatePayload.created_by = user.id
      }

      const { error } = await supabase
        .from('worlds')
        .update(updatePayload)
        .eq('id', world.id)

      if (error) throw error

      toast.success('World saved successfully!')
    } catch {
      toast.error('Failed to save world')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="p-8">Loading...</div>
      </AppLayout>
    )
  }

  if (!world) {
    return null
  }

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-[#6EE7F2] to-[#DA77F2] bg-clip-text text-transparent mb-1">
              {world.name}
            </h1>
            <p className="text-fg-1 text-sm">World Editor</p>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-[#6EE7F2] to-[#DA77F2] hover:from-[#DA77F2] hover:to-[#6EE7F2] text-bg-0 font-semibold shadow-lg shadow-[#6EE7F2]/20 hover:shadow-[#DA77F2]/30 transition-all duration-300 px-8"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>

        <Tabs defaultValue="world" className="w-full">
          <TabsList className="grid w-full grid-cols-5 lg:grid-cols-10 bg-bg-2 p-2 rounded-2xl gap-1">
            <TabsTrigger
              value="world"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#6EE7F2]/20 data-[state=active]:to-[#DA77F2]/20 data-[state=active]:text-[#6EE7F2] data-[state=active]:shadow-lg data-[state=active]:shadow-[#6EE7F2]/10 rounded-xl transition-all duration-300"
            >
              World
            </TabsTrigger>
            <TabsTrigger
              value="npcs"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#DA77F2]/20 data-[state=active]:to-[#6EE7F2]/20 data-[state=active]:text-[#DA77F2] data-[state=active]:shadow-lg data-[state=active]:shadow-[#DA77F2]/10 rounded-xl transition-all duration-300"
            >
              NPCs
            </TabsTrigger>
            <TabsTrigger
              value="items"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#F2B880]/20 data-[state=active]:to-[#DA77F2]/20 data-[state=active]:text-[#F2B880] data-[state=active]:shadow-lg data-[state=active]:shadow-[#F2B880]/10 rounded-xl transition-all duration-300"
            >
              Items
            </TabsTrigger>
            <TabsTrigger
              value="abilities"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#6EE7F2]/20 data-[state=active]:to-[#F2B880]/20 data-[state=active]:text-[#6EE7F2] data-[state=active]:shadow-lg data-[state=active]:shadow-[#6EE7F2]/10 rounded-xl transition-all duration-300"
            >
              Abilities
            </TabsTrigger>
            <TabsTrigger
              value="organizations"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#DA77F2]/20 data-[state=active]:to-[#6EE7F2]/20 data-[state=active]:text-[#DA77F2] data-[state=active]:shadow-lg data-[state=active]:shadow-[#DA77F2]/10 rounded-xl transition-all duration-300"
            >
              Orgs
            </TabsTrigger>
            <TabsTrigger
              value="taxonomies"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#F2B880]/20 data-[state=active]:to-[#DA77F2]/20 data-[state=active]:text-[#F2B880] data-[state=active]:shadow-lg data-[state=active]:shadow-[#F2B880]/10 rounded-xl transition-all duration-300"
            >
              Taxonomies
            </TabsTrigger>
            <TabsTrigger
              value="locations"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#6EE7F2]/20 data-[state=active]:to-[#F2B880]/20 data-[state=active]:text-[#6EE7F2] data-[state=active]:shadow-lg data-[state=active]:shadow-[#6EE7F2]/10 rounded-xl transition-all duration-300"
            >
              Locations
            </TabsTrigger>
            <TabsTrigger
              value="rules"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#DA77F2]/20 data-[state=active]:to-[#F2B880]/20 data-[state=active]:text-[#DA77F2] data-[state=active]:shadow-lg data-[state=active]:shadow-[#DA77F2]/10 rounded-xl transition-all duration-300"
            >
              Rules
            </TabsTrigger>
            <TabsTrigger
              value="story"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#6EE7F2]/20 data-[state=active]:to-[#DA77F2]/20 data-[state=active]:text-[#6EE7F2] data-[state=active]:shadow-lg data-[state=active]:shadow-[#6EE7F2]/10 rounded-xl transition-all duration-300"
            >
              Story
            </TabsTrigger>
            <TabsTrigger
              value="player-fields"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#F2B880]/20 data-[state=active]:to-[#6EE7F2]/20 data-[state=active]:text-[#F2B880] data-[state=active]:shadow-lg data-[state=active]:shadow-[#F2B880]/10 rounded-xl transition-all duration-300"
            >
              Player
            </TabsTrigger>
          </TabsList>

          <TabsContent value="world" className="space-y-6 mt-6">
            {/* Image Upload */}
            <div className="space-y-2">
              <Label className="text-[#DA77F2] font-semibold">World Cover Image</Label>
              {world.image_url ? (
                <div className="relative h-64 rounded-xl overflow-hidden border border-border">
                  <Image
                    src={world.image_url}
                    alt={world.name}
                    fill
                    className="object-cover"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute top-2 right-2 bg-bg-0/80 border-red-500/30 hover:border-red-500"
                    onClick={() => setWorld({ ...world, image_url: null })}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-border rounded-xl p-12 text-center hover:border-[#DA77F2]/50 transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    id="world-image"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleImageUpload(file)
                    }}
                  />
                  <label htmlFor="world-image" className="cursor-pointer">
                    <Upload className="w-12 h-12 mx-auto mb-3 text-[#DA77F2]" />
                    <p className="text-fg-1">
                      {uploading ? 'Uploading...' : 'Click to upload world cover image'}
                    </p>
                  </label>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name" className="text-[#6EE7F2] font-semibold">World Name</Label>
              <Input
                id="name"
                value={world.name}
                onChange={(e) => setWorld({ ...world, name: e.target.value })}
                className="bg-bg-2 border-border focus:border-[#6EE7F2] focus:ring-[#6EE7F2]/20 transition-all"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone" className="text-[#DA77F2] font-semibold">Tone</Label>
              <Input
                id="tone"
                value={world.tone || ''}
                onChange={(e) => setWorld({ ...world, tone: e.target.value })}
                placeholder="e.g., Dark fantasy, Lighthearted adventure"
                className="bg-bg-2 border-border focus:border-[#DA77F2] focus:ring-[#DA77F2]/20 transition-all"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-[#F2B880] font-semibold">Description (Promotional)</Label>
              <Textarea
                id="description"
                value={world.description}
                onChange={(e) => setWorld({ ...world, description: e.target.value })}
                rows={4}
                className="bg-bg-2 border-border focus:border-[#F2B880] focus:ring-[#F2B880]/20 transition-all"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="setting" className="text-[#6EE7F2] font-semibold">Setting (Gameplay Canon)</Label>
              <Textarea
                id="setting"
                value={world.setting}
                onChange={(e) => setWorld({ ...world, setting: e.target.value })}
                rows={6}
                className="bg-bg-2 border-border focus:border-[#6EE7F2] focus:ring-[#6EE7F2]/20 transition-all"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="starter" className="text-[#DA77F2] font-semibold">
                Starter Message (Optional)
              </Label>
              <p className="text-sm text-fg-1 mb-2">
                This message will be automatically sent to players at the beginning of a session. Leave empty to skip.
              </p>
              <Textarea
                id="starter"
                value={world.starter || ''}
                onChange={(e) => setWorld({ ...world, starter: e.target.value })}
                rows={4}
                placeholder="e.g., You wake up in a dimly lit tavern. The sounds of laughter and clinking mugs fill the air..."
                className="bg-bg-2 border-border focus:border-[#DA77F2] focus:ring-[#DA77F2]/20 transition-all"
              />
            </div>

          </TabsContent>

          <TabsContent value="npcs" className="mt-6">
            <NPCManager worldId={world.id} />
          </TabsContent>

          <TabsContent value="items" className="mt-6">
            <ItemManager worldId={world.id} />
          </TabsContent>

          <TabsContent value="abilities" className="mt-6">
            <AbilityManager worldId={world.id} />
          </TabsContent>

          <TabsContent value="organizations" className="mt-6">
            <GenericEntityManager
              worldId={world.id}
              tableName="organizations"
              entityName="Organization"
              entityNamePlural="Organizations"
              accentColor="#DA77F2"
              description="Manage factions, guilds, and organizations"
            />
          </TabsContent>

          <TabsContent value="taxonomies" className="mt-6">
            <GenericEntityManager
              worldId={world.id}
              tableName="taxonomies"
              entityName="Taxonomy"
              entityNamePlural="Taxonomies"
              accentColor="#F2B880"
              description="Define categories, types, and classifications"
            />
          </TabsContent>

          <TabsContent value="locations" className="mt-6">
            <LocationManager worldId={world.id} />
          </TabsContent>

          <TabsContent value="rules" className="mt-6">
            <RuleManager worldId={world.id} />
          </TabsContent>

          <TabsContent value="story" className="mt-6">
            <StoryGraphManagerWrapper worldId={world.id} />
          </TabsContent>

          <TabsContent value="player-fields" className="mt-6">
            <PlayerFieldsManager worldId={world.id} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
