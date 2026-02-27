'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { AppLayout } from '@/components/layout/app-layout'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { Database } from '@/lib/database.types'
import { Trash2, Package, Sparkles } from 'lucide-react'

type InventoryRow = { id: string; item_name: string; quantity: number; slot_type: string | null }

type Session = Database['public']['Tables']['sessions']['Row'] & {
  worlds: Database['public']['Tables']['worlds']['Row']
  players?: (Database['public']['Tables']['players']['Row'] & {
    dynamic_fields?: Record<string, unknown>
  })[]
  player_inventory?: InventoryRow[]
}

export default function MySessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()
  const { user } = useAuth()

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string, worldName: string) => {
    e.stopPropagation()
    if (!confirm(`删除「${worldName}」的存档？所有对话和角色数据将永久删除，无法恢复。`)) return
    try {
      const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
      if (error) throw error
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      toast.success('存档已删除')
    } catch {
      toast.error('删除失败')
    }
  }

  const fetchSessions = useCallback(async () => {
    try {
      console.log('Fetching sessions for user:', user?.id)
      
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          *,
          worlds (
            id,
            name,
            image_url,
            description
          ),
          players (
            id,
            name,
            dynamic_fields
          ),
          player_inventory (
            id,
            item_name,
            quantity,
            slot_type
          )
        `)
        .eq('created_by', user?.id)
        .order('started_at', { ascending: false })

      if (error) {
        console.error('Error fetching sessions:', error)
        throw error
      }
      
      console.log('Sessions data:', data)
      setSessions((data as Session[]) || [])
    } catch (error) {
      console.error('Failed to load sessions:', error)
      toast.error('Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [supabase, user?.id])

  useEffect(() => {
    if (user) {
      fetchSessions()
    }
  }, [user, fetchSessions])

  return (
    <AppLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-[#F2B880] via-[#DA77F2] to-[#6EE7F2] bg-clip-text text-transparent mb-2">
            My Sessions
          </h1>
          <p className="text-fg-1">Continue your adventures or start new ones</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 text-fg-1">
            <div className="w-2 h-2 bg-[#F2B880] rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-[#DA77F2] rounded-full animate-pulse delay-75" />
            <div className="w-2 h-2 bg-[#6EE7F2] rounded-full animate-pulse delay-150" />
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <Card className="bg-gradient-to-br from-bg-1 to-bg-2 border-[#F2B880]/20 p-12 text-center">
            <p className="text-fg-1 mb-4">No sessions yet.</p>
            <p className="text-[#F2B880]">Browse worlds to start a new session!</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {sessions.map((session, index) => {
              const accentColors = ['#F2B880', '#DA77F2', '#6EE7F2']
              const accentColor = accentColors[index % 3]

              return (
                <motion.div
                  key={session.id}
                  className="relative group"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ x: 8, scale: 1.01 }}
                >
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id, session.worlds?.name || '未知世界')}
                    className="absolute top-3 right-3 z-20 p-1.5 rounded-md bg-bg-0/80 text-fg-1 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all duration-200"
                    title="删除存档"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <Card
                    className="cursor-pointer bg-gradient-to-r from-bg-1 to-bg-2 border-border hover:border-[var(--accent-color)] hover:shadow-xl hover:shadow-[var(--accent-color)]/10 transition-all duration-300 overflow-hidden group"
                    onClick={() => router.push(`/sessions/${session.id}`)}
                    style={{ '--accent-color': accentColor } as React.CSSProperties}
                  >
                    <CardContent className="p-0 flex items-center gap-6">
                      <div
                        className="w-2 h-full transition-all duration-300 group-hover:w-3"
                        style={{ backgroundColor: accentColor }}
                      />
                      {session.worlds?.image_url && (
                        <div className="relative w-24 h-24 my-4 overflow-hidden rounded-xl">
                          <Image
                            src={session.worlds.image_url}
                            alt={session.worlds?.name || 'World'}
                            fill
                            className="object-cover transition-transform duration-500 group-hover:scale-110"
                          />
                          <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-xl" />
                        </div>
                      )}
                      <div className="flex-1 py-6 pr-6">
                        <h3 className="text-xl font-semibold text-fg-0 mb-1 group-hover:text-[var(--accent-color)] transition-colors">
                          {session.worlds?.name || 'Unknown World'}
                        </h3>
                        <p className="text-fg-1 text-sm mb-3">{session.title}</p>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                          <span className="text-fg-1">
                            <span className="text-[#6EE7F2]">开始:</span> {new Date(session.started_at).toLocaleDateString()}
                          </span>
                          {session.players && session.players.length > 0 && session.players[0].name && (
                            <span className="text-fg-1">
                              <span className="text-[#DA77F2]">角色:</span> {session.players[0].name}
                            </span>
                          )}
                          {(() => {
                            const dynFields = (session.players?.[0]?.dynamic_fields ?? {}) as Record<string, unknown>
                            const hp = dynFields['hp'] ?? dynFields['HP']
                            const mp = dynFields['mp'] ?? dynFields['MP']
                            if (hp == null && mp == null) return null
                            return (
                              <span className="text-fg-1">
                                {hp != null && <><span className="text-red-400">HP</span> {String(hp)}</>}
                                {hp != null && mp != null && <span className="text-fg-2 mx-1">/</span>}
                                {mp != null && <><span className="text-blue-400">MP</span> {String(mp)}</>}
                              </span>
                            )
                          })()}
                        </div>
                        {/* Inventory & abilities summary */}
                        {session.player_inventory && session.player_inventory.length > 0 && (() => {
                          const inv = session.player_inventory as InventoryRow[]
                          const items = inv.filter(i => i.slot_type !== 'ability')
                          const abilities = inv.filter(i => i.slot_type === 'ability')
                          return (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {items.map(item => (
                                <span key={item.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#F2B880]/10 text-[10px] text-[#F2B880]">
                                  <Package className="w-2.5 h-2.5" />
                                  {item.item_name}{item.quantity > 1 && ` x${item.quantity}`}
                                </span>
                              ))}
                              {abilities.map(a => (
                                <span key={a.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#6EE7F2]/10 text-[10px] text-[#6EE7F2]">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  {a.item_name}
                                </span>
                              ))}
                            </div>
                          )
                        })()}
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
