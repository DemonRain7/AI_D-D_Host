'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Globe, BookOpen, Gamepad2, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

const navItems = [
  { href: '/browse', label: 'Browse Worlds', icon: Globe },
  { href: '/manage', label: 'Manage Worlds', icon: BookOpen },
  { href: '/sessions', label: 'My Sessions', icon: Gamepad2 },
]

export function Navbar() {
  const pathname = usePathname()
  const { signOut } = useAuth()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    toast.success('Goodbye! See you soon.')
    router.push('/')
  }

  return (
    <nav className="fixed left-0 top-0 h-screen w-64 bg-gradient-to-b from-bg-1 to-bg-0 border-r border-border/50 flex flex-col backdrop-blur-sm">
      {/* Logo */}
      <div className="p-6 border-b border-border/30">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-2xl font-bold bg-gradient-to-r from-[#6EE7F2] via-[#DA77F2] to-[#6EE7F2] bg-clip-text text-transparent"
          style={{
            filter: 'drop-shadow(0 0 20px rgba(110, 231, 242, 0.3))',
          }}
        >
          LLM GM
        </motion.div>
      </div>

      {/* Navigation Items */}
      <div className="flex-1 px-4 py-6 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname?.startsWith(item.href)

          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                className={`
                  relative flex items-center gap-3 px-4 py-3 rounded-2xl transition-all overflow-hidden
                  ${isActive
                    ? 'bg-gradient-to-r from-[#6EE7F2]/20 to-[#DA77F2]/20 text-[#6EE7F2] shadow-lg shadow-[#6EE7F2]/10'
                    : 'text-fg-1 hover:bg-bg-2 hover:text-fg-0'
                  }
                `}
                whileHover={{ y: -2, scale: 1.02 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                style={isActive ? {
                  boxShadow: '0 0 20px rgba(110, 231, 242, 0.2), inset 0 0 20px rgba(110, 231, 242, 0.05)'
                } : {}}
              >
                {isActive && (
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-[#6EE7F2]/10 to-[#DA77F2]/10"
                    layoutId="activeNav"
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
                <Icon className="w-5 h-5 relative z-10" />
                <span className="relative z-10">{item.label}</span>
              </motion.div>
            </Link>
          )
        })}
      </div>

      {/* Logout Button */}
      <div className="p-4 border-t border-border/30">
        <Button
          variant="ghost"
          onClick={handleSignOut}
          className="w-full justify-start gap-3 text-fg-1 hover:text-[#F2B880] hover:bg-bg-2 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </Button>
      </div>
    </nav>
  )
}
