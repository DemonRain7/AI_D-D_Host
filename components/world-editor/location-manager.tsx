'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { 
  Plus, 
  Save, 
  Copy, 
  ChevronRight, 
  ChevronDown, 
  GripVertical,
  MapPin,
  Home,
  Folder,
  FolderOpen
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'

interface Location {
  id: string
  world_id: string
  name: string
  aliases: string[] | null
  description: string
  parent_location_id: string | null
  path: string
  created_by: string | null
  created_at: string
  updated_at: string
}

type LocationWithChildren = Location & {
  children: LocationWithChildren[]
}

interface LocationManagerProps {
  worldId: string
}

export function LocationManager({ worldId }: LocationManagerProps) {
  const [locations, setLocations] = useState<LocationWithChildren[]>([])
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draggedLocation, setDraggedLocation] = useState<Location | null>(null)
  const [dragOverLocation, setDragOverLocation] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  
  const [formData, setFormData] = useState({
    name: '',
    aliases: '',
    description: '',
  })
  
  const supabase = createClient()
  const { user } = useAuth()

  const fetchLocations = useCallback(async (preserveExpandedState = false) => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('world_id', worldId)
        .order('created_at', { ascending: false })

      if (error) throw error

      // Build tree structure
      const locationMap = new Map<string, LocationWithChildren>()
      const rootLocations: LocationWithChildren[] = []

      // First pass: create all location objects
      data?.forEach(location => {
        locationMap.set(location.id, { ...location, children: [] })
      })

      // Second pass: build tree structure
      data?.forEach(location => {
        const locationWithChildren = locationMap.get(location.id)!
        if (location.parent_location_id) {
          const parent = locationMap.get(location.parent_location_id)
          if (parent) {
            parent.children.push(locationWithChildren)
          }
        } else {
          rootLocations.push(locationWithChildren)
        }
      })

      setLocations(rootLocations)
      
      // Only auto-expand first level if not preserving state
      if (!preserveExpandedState) {
        const firstLevelIds = rootLocations.map(loc => loc.id)
        setExpandedNodes(new Set(firstLevelIds))
      }
    } catch {
      toast.error('Failed to load locations')
    } finally {
      setLoading(false)
    }
  }, [supabase, worldId])

  useEffect(() => {
    fetchLocations()
  }, [fetchLocations])

  const handleCreateLocation = async (parentId?: string) => {
    try {
      const { data: newLocation, error } = await supabase
        .from('locations')
        .insert({
          world_id: worldId,
          name: 'New Location',
          description: 'A new location waiting to be defined',
          aliases: [],
          parent_location_id: parentId || null,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error

      toast.success('Location created!')
      await fetchLocations(true) // Preserve expanded state
      
      // Open the modal for editing the new location
      setFormData({
        name: newLocation.name,
        aliases: newLocation.aliases?.join(', ') || '',
        description: newLocation.description,
      })
      setSelectedLocation(newLocation)
      setIsEditing(true)
    } catch {
      toast.error('Failed to create location')
    }
  }

  const handleSaveLocation = async () => {
    if (!formData.name.trim() || !formData.description.trim()) {
      toast.error('Name and description are required')
      return
    }

    setSaving(true)
    try {
      // Generate embedding for the location
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

      const locationData = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        aliases: formData.aliases
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        embedding, // Include the generated embedding
        updated_at: new Date().toISOString(),
      }

      if (selectedLocation) {
        // Update existing location
        const { error } = await supabase
          .from('locations')
          .update(locationData)
          .eq('id', selectedLocation.id)

        if (error) throw error
        toast.success('Location updated successfully!')
      }

      await fetchLocations(true) // Preserve expanded state
      setIsEditing(false)
      setSelectedLocation(null)
    } catch (error) {
      console.error('Save error:', error)
      toast.error('Failed to save location')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (location: Location) => {
    setFormData({
      name: location.name,
      aliases: location.aliases?.join(', ') || '',
      description: location.description,
    })
    setSelectedLocation(location)
    setIsEditing(true)
  }

  const handleAdd = async () => {
    try {
      const { data: newLocation, error } = await supabase
        .from('locations')
        .insert({
          world_id: worldId,
          name: 'New Location',
          description: 'A new location waiting to be defined',
          aliases: [],
          parent_location_id: null,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error

      toast.success('Location created!')
      await fetchLocations(true) // Preserve expanded state
      
      // Open the modal for editing the new location
      setFormData({
        name: newLocation.name,
        aliases: newLocation.aliases?.join(', ') || '',
        description: newLocation.description,
      })
      setSelectedLocation(newLocation)
      setIsEditing(true)
    } catch {
      toast.error('Failed to create location')
    }
  }

  const handleDeleteLocation = async (locationId: string) => {
    if (!confirm('Are you sure you want to delete this location? This will also delete all child locations.')) {
      return
    }

    try {
      const { error } = await supabase
        .from('locations')
        .delete()
        .eq('id', locationId)

      if (error) throw error

      toast.success('Location deleted!')
      await fetchLocations(true) // Preserve expanded state
      if (selectedLocation?.id === locationId) {
        setSelectedLocation(null)
        setIsEditing(false)
      }
    } catch {
      toast.error('Failed to delete location')
    }
  }

  const handleReparentLocation = async (locationId: string, newParentId: string | null) => {
    try {
      const { error } = await supabase
        .from('locations')
        .update({
          parent_location_id: newParentId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', locationId)

      if (error) throw error

      toast.success('Location moved!')
      await fetchLocations(true) // Preserve expanded state
    } catch {
      toast.error('Failed to move location')
    }
  }

  const handleCopyJSON = () => {
    const jsonData = {
      name: formData.name,
      aliases: formData.aliases.split(',').map(a => a.trim()).filter(Boolean),
      description: formData.description,
    }
    
    navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2))
    toast.success('Location data copied to clipboard!')
  }

  const toggleExpanded = (locationId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(locationId)) {
      newExpanded.delete(locationId)
    } else {
      newExpanded.add(locationId)
    }
    setExpandedNodes(newExpanded)
  }

  const handleDragOver = (e: React.DragEvent, locationId: string) => {
    e.preventDefault()
    setDragOverLocation(locationId)
  }

  const handleDragLeave = () => {
    setDragOverLocation(null)
  }

  const handleDrop = async (e: React.DragEvent, targetLocationId: string) => {
    e.preventDefault()
    setDragOverLocation(null)
    
    if (!draggedLocation || draggedLocation.id === targetLocationId) {
      return
    }

    // Prevent dropping on a child location
    const isChild = (parent: LocationWithChildren, childId: string): boolean => {
      if (parent.id === childId) return true
      return parent.children.some(child => isChild(child, childId))
    }

    const targetLocation = findLocationById(targetLocationId)
    if (targetLocation && isChild(targetLocation, draggedLocation.id)) {
      toast.error('Cannot move a location into its own child')
      return
    }

    await handleReparentLocation(draggedLocation.id, targetLocationId)
  }

  const findLocationById = (id: string): LocationWithChildren | null => {
    const search = (locations: LocationWithChildren[]): LocationWithChildren | null => {
      for (const location of locations) {
        if (location.id === id) return location
        const found = search(location.children)
        if (found) return found
      }
      return null
    }
    return search(locations)
  }

  const renderLocationTree = (location: LocationWithChildren, depth = 0) => {
    const isExpanded = expandedNodes.has(location.id)
    const isSelected = selectedLocation?.id === location.id
    const hasChildren = location.children.length > 0
    const isDragOver = dragOverLocation === location.id
    const isDragging = draggedLocation?.id === location.id

    return (
      <div key={location.id}>
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all duration-200 hover:bg-bg-2/50 ${
            isSelected ? 'bg-[#6EE7F2]/10 border border-[#6EE7F2]/30' : ''
          } ${
            isDragOver ? 'bg-[#6EE7F2]/20 border-2 border-dashed border-[#6EE7F2]' : ''
          } ${
            isDragging ? 'opacity-50' : ''
          }`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => handleEdit(location)}
          draggable
          onDragStart={() => setDraggedLocation(location)}
          onDragEnd={() => {
            setDraggedLocation(null)
            setDragOverLocation(null)
          }}
          onDragOver={(e) => handleDragOver(e, location.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, location.id)}
        >
          <div className="flex items-center gap-1">
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpanded(location.id)
                }}
                className="p-1 hover:bg-bg-2 rounded transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-[#6EE7F2]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[#6EE7F2]" />
                )}
              </button>
            ) : (
              <div className="w-6" />
            )}
            
            {depth === 0 ? (
              <Home className="w-4 h-4 text-[#6EE7F2]" />
            ) : isExpanded ? (
              <FolderOpen className="w-4 h-4 text-[#6EE7F2]" />
            ) : (
              <Folder className="w-4 h-4 text-[#6EE7F2]" />
            )}
          </div>

          <GripVertical className="w-4 h-4 text-fg-2 cursor-grab active:cursor-grabbing" />
          <span className="flex-1 text-fg-0 font-medium">{location.name}</span>
          
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleCreateLocation(location.id)
              }}
              className="h-6 w-6 p-0 hover:bg-[#6EE7F2]/20"
            >
              <Plus className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteLocation(location.id)
              }}
              className="h-6 w-6 p-0 hover:bg-red-500/20 text-red-400"
            >
              ×
            </Button>
          </div>
        </motion.div>

        <AnimatePresence>
          {isExpanded && hasChildren && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              {location.children.map(child => renderLocationTree(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-fg-1">
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-75" />
          <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-150" />
          Loading locations...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Location Tree */}
      <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#6EE7F2]/20">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[#6EE7F2] flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Location Hierarchy
            </h3>
            <Button
              onClick={handleAdd}
              className="bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] hover:from-[#F2B880] hover:to-[#6EE7F2] text-bg-0 font-semibold"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Root
            </Button>
          </div>

          <div 
            className="space-y-1 max-h-96 overflow-y-auto min-h-32"
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverLocation('root')
            }}
            onDragLeave={() => setDragOverLocation(null)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOverLocation(null)
              if (draggedLocation) {
                handleReparentLocation(draggedLocation.id, null)
              }
            }}
          >
            {dragOverLocation === 'root' && draggedLocation && (
              <div className="border-2 border-dashed border-[#6EE7F2] rounded-lg p-4 text-center text-[#6EE7F2] bg-[#6EE7F2]/10 mb-2">
                Drop here to make it a root location
              </div>
            )}
            
            {locations.length === 0 ? (
              <div className="text-center py-8 text-fg-1">
                <MapPin className="w-12 h-12 mx-auto mb-3 text-[#6EE7F2]/50" />
                <p>No locations yet</p>
                <p className="text-sm">Create your first location to get started</p>
              </div>
            ) : (
              locations.map(location => renderLocationTree(location))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Edit Modal */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="bg-bg-0 border-[#6EE7F2]/30 max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="space-y-6">
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] bg-clip-text text-transparent">
              {selectedLocation ? 'Edit Location' : 'New Location'}
            </DialogTitle>

            {/* Breadcrumb */}
            {selectedLocation && (
              <div className="flex items-center gap-2 text-sm text-fg-1">
                <span>Path:</span>
                <div className="flex items-center gap-1">
                  {selectedLocation.path.split('.').map((segment, index, array) => (
                    <div key={index} className="flex items-center gap-1">
                      <span className="text-[#6EE7F2]">{segment}</span>
                      {index < array.length - 1 && <ChevronRight className="w-3 h-3" />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-[#6EE7F2] font-semibold">
                  Location Name *
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-bg-2 border-border focus:border-[#6EE7F2] focus:ring-[#6EE7F2]/20 transition-all"
                  placeholder="Enter location name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="aliases" className="text-[#DA77F2] font-semibold">
                  Aliases (comma-separated)
                </Label>
                <Input
                  id="aliases"
                  value={formData.aliases}
                  onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                  placeholder="Alternative names, comma-separated"
                  className="bg-bg-2 border-border focus:border-[#DA77F2] focus:ring-[#DA77F2]/20 transition-all"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="text-[#F2B880] font-semibold">
                  Description *
                </Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={6}
                  className="bg-bg-2 border-border focus:border-[#F2B880] focus:ring-[#F2B880]/20 transition-all"
                  placeholder="Describe this location"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleCopyJSON}
                className="border-[#6EE7F2]/30 hover:border-[#6EE7F2]"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy JSON
              </Button>
              <Button
                onClick={handleSaveLocation}
                disabled={saving}
                className="bg-gradient-to-r from-[#6EE7F2] to-[#F2B880] hover:from-[#F2B880] hover:to-[#6EE7F2] text-bg-0 font-semibold"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
