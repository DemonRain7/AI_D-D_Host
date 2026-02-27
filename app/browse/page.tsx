'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { AppLayout } from '@/components/layout/app-layout'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { Database } from '@/lib/database.types'
import { useAuth } from '@/contexts/auth-context'

type World = Database['public']['Tables']['worlds']['Row']

export default function BrowseWorldsPage() {
  const [worlds, setWorlds] = useState<World[]>([])
  const [selectedWorld, setSelectedWorld] = useState<World | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()
  const { user } = useAuth()

  const fetchWorlds = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('worlds')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setWorlds(data || [])
    } catch {
      toast.error('Failed to load worlds')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchWorlds()
  }, [fetchWorlds])

  const handleStartSession = async (worldId: string) => {
    try {
      if (!user?.id) {
        toast.error('You must be logged in to create a session')
        return
      }

      const sessionData = {
        world_id: worldId,
        title: `Session ${new Date().toLocaleString()}`,
        created_by: user.id,
      }

      const { data: session, error } = await supabase
        .from('sessions')
        .insert(sessionData)
        .select()
        .single()

      if (error) throw error

      toast.success('Session created!')
      router.push(`/sessions/${session.id}`)
    } catch {
      toast.error('Failed to create session')
    }
  }

  return (
    <AppLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-[#6EE7F2] via-[#DA77F2] to-[#F2B880] bg-clip-text text-transparent mb-2">
            Browse Worlds
          </h1>
          <p className="text-fg-1">Explore and start adventures in existing worlds</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 text-fg-1">
            <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse delay-75" />
            <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse delay-150" />
            Loading worlds...
          </div>
        ) : worlds.length === 0 ? (
          <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#6EE7F2]/20 p-12 text-center">
            <p className="text-fg-1 mb-4">No worlds available yet.</p>
            <p className="text-[#6EE7F2]">Create your own in Manage Worlds!</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {worlds.map((world, index) => {
              const accentColors = ['#6EE7F2', '#DA77F2', '#F2B880']
              const accentColor = accentColors[index % 3]

              return (
                <motion.div
                  key={world.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ scale: 1.03, y: -4 }}
                >
                  <Card
                    className="cursor-pointer bg-gradient-to-br from-bg-1 to-bg-2 border-border hover:border-[var(--accent-color)] transition-all duration-300 overflow-hidden group aspect-[4/3] !py-0"
                    onClick={() => setSelectedWorld(world)}
                    style={{ '--accent-color': accentColor } as React.CSSProperties}
                  >
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
                          style={{ backgroundColor: accentColor }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* World Detail Modal */}
        <Dialog open={!!selectedWorld} onOpenChange={() => setSelectedWorld(null)}>
          <DialogContent className="bg-gradient-to-br from-bg-1 to-bg-0 border-[#6EE7F2]/30 max-w-2xl shadow-2xl shadow-[#6EE7F2]/10">
            {selectedWorld && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-3xl font-bold bg-gradient-to-r from-[#6EE7F2] to-[#DA77F2] bg-clip-text text-transparent">
                    {selectedWorld.name}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-6">
                  {selectedWorld.image_url && (
                    <div className="relative rounded-xl overflow-hidden h-64">
                      <Image
                        src={selectedWorld.image_url}
                        alt={selectedWorld.name}
                        fill
                        className="object-cover"
                      />
                      <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-xl" />
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold text-[#6EE7F2] mb-2 text-sm uppercase tracking-wider">Description</h4>
                      <p className="text-fg-0 leading-relaxed">{selectedWorld.description}</p>
                    </div>
                    {selectedWorld.tone && (
                      <div>
                        <h4 className="font-semibold text-[#DA77F2] mb-2 text-sm uppercase tracking-wider">Tone</h4>
                        <p className="text-fg-0">{selectedWorld.tone}</p>
                      </div>
                    )}
                  </div>
                  <Button
                    className="w-full bg-gradient-to-r from-[#6EE7F2] to-[#DA77F2] hover:from-[#DA77F2] hover:to-[#6EE7F2] text-bg-0 font-semibold py-6 text-lg shadow-lg shadow-[#6EE7F2]/20 hover:shadow-[#DA77F2]/30 transition-all duration-300"
                    onClick={() => handleStartSession(selectedWorld.id)}
                  >
                    Start a Session
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  )
}
