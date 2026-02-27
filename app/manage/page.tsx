'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { AppLayout } from '@/components/layout/app-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { Database } from '@/lib/database.types'

type World = Database['public']['Tables']['worlds']['Row']

export default function ManageWorldsPage() {
  const [worlds, setWorlds] = useState<World[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()
  const { user } = useAuth()

  const fetchWorlds = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('worlds')
        .select('*')
        .or(`created_by.eq.${user?.id},created_by.is.null`)
        .order('created_at', { ascending: false })

      if (error) throw error
      setWorlds(data || [])
    } catch {
      toast.error('Failed to load worlds')
    } finally {
      setLoading(false)
    }
  }, [supabase, user?.id])

  useEffect(() => {
    if (user) {
      fetchWorlds()
    }
  }, [user, fetchWorlds])

  const handleDeleteWorld = async (e: React.MouseEvent, worldId: string, worldName: string) => {
    e.stopPropagation()
    if (!confirm(`Delete "${worldName}"? This will permanently delete the world and all its sessions, NPCs, items, and other content.`))
      return

    try {
      const { error } = await supabase.from('worlds').delete().eq('id', worldId)
      if (error) throw error
      setWorlds(prev => prev.filter(w => w.id !== worldId))
      toast.success(`"${worldName}" deleted`)
    } catch {
      toast.error('Failed to delete world')
    }
  }

  const handleCreateWorld = async () => {
    try {
      const { data: world, error } = await supabase
        .from('worlds')
        .insert({
          name: 'New World',
          setting: 'A new world waiting to be defined',
          description: 'An exciting new world',
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error

      toast.success('World created!')
      router.push(`/manage/${world.id}`)
    } catch {
      toast.error('Failed to create world')
    }
  }

  return (
    <AppLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-[#DA77F2] via-[#6EE7F2] to-[#F2B880] bg-clip-text text-transparent mb-2">
            Manage Worlds
          </h1>
          <p className="text-fg-1">Create and customize your own worlds</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 text-fg-1">
            <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-75" />
            <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse delay-150" />
            Loading your worlds...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* New World Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.05, rotate: 1 }}
              whileTap={{ scale: 0.98 }}
            >
              <Card
                className="cursor-pointer relative bg-gradient-to-br from-bg-1 to-bg-2 border-2 border-dashed border-[#DA77F2]/50 hover:border-[#DA77F2] hover:shadow-2xl hover:shadow-[#DA77F2]/20 transition-all duration-300 aspect-[4/3] flex items-center justify-center overflow-hidden group !py-0"
                onClick={handleCreateWorld}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[#DA77F2]/5 to-[#6EE7F2]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <CardContent className="flex flex-col items-center gap-4 relative z-10">
                  <motion.div
                    animate={{
                      scale: [1, 1.15, 1],
                      rotate: [0, 5, -5, 0],
                    }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="relative"
                  >
                    <Plus className="w-16 h-16 text-[#DA77F2] drop-shadow-[0_0_15px_rgba(218,119,242,0.5)]" />
                  </motion.div>
                  <p className="text-lg font-semibold bg-gradient-to-r from-[#DA77F2] to-[#6EE7F2] bg-clip-text text-transparent">
                    Create New World
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            {/* Existing Worlds */}
            {worlds.map((world, index) => {
              const accentColors = ['#DA77F2', '#6EE7F2', '#F2B880']
              const accentColor = accentColors[index % 3]

              return (
                <motion.div
                  key={world.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 + 0.1, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ scale: 1.05, y: -4 }}
                >
                  <Card
                    className="cursor-pointer bg-gradient-to-br from-bg-1 to-bg-2 border-border hover:border-[var(--accent-color)] hover:shadow-xl hover:shadow-[var(--accent-color)]/10 transition-all duration-300 aspect-[4/3] overflow-hidden group !py-0 relative"
                    onClick={() => router.push(`/manage/${world.id}`)}
                    style={{ '--accent-color': accentColor } as React.CSSProperties}
                  >
                    {/* Delete button — top-right, appears on hover */}
                    <button
                      onClick={(e) => handleDeleteWorld(e, world.id, world.name)}
                      className="absolute top-2 right-2 z-20 p-1.5 rounded-md bg-bg-0/80 backdrop-blur-sm text-fg-2 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all duration-200"
                      title="Delete world"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <CardContent className="p-0 h-full flex flex-col">
                      {/* Image section - always present, fills most of the card */}
                      <div className="relative overflow-hidden flex-1">
                        {world.image_url ? (
                          <>
                            <Image
                              src={world.image_url}
                              alt={world.name}
                              fill
                              className="object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-bg-0/80 to-transparent" />
                          </>
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-bg-2 to-bg-1 flex items-center justify-center">
                            <div className="text-center">
                              <div className="w-16 h-16 mx-auto mb-2 rounded-full bg-gradient-to-br from-[var(--accent-color)]/20 to-[var(--accent-color)]/10 flex items-center justify-center">
                                <span className="text-2xl font-bold text-[var(--accent-color)]">
                                  {world.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <p className="text-fg-2 text-sm">No image</p>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Content section - fixed height at bottom */}
                      <div className="p-3 flex-shrink-0">
                        <h3 className="text-base font-semibold text-fg-0 group-hover:text-[var(--accent-color)] transition-colors">
                          {world.name}
                        </h3>
                        <div
                          className="mt-2 h-0.5 w-0 group-hover:w-full transition-all duration-500 rounded-full"
                          style={{ backgroundColor: accentColor, boxShadow: `0 0 10px ${accentColor}` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
