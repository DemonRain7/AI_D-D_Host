'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'

export default function LandingPage() {
  const router = useRouter()

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bg-0">
      {/* Background with gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-bg-0 via-bg-1 to-bg-0" />

      {/* Animated background elements - multiple overlapping gradients */}
      <motion.div
        className="absolute inset-0 opacity-30"
        animate={{
          backgroundPosition: ['0% 0%', '100% 100%'],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          repeatType: 'reverse',
          ease: 'linear',
        }}
        style={{
          backgroundImage: `
            radial-gradient(circle at 20% 50%, rgba(110, 231, 242, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(218, 119, 242, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 40% 20%, rgba(242, 184, 128, 0.1) 0%, transparent 50%)
          `,
          backgroundSize: '200% 200%',
        }}
      />

      {/* Floating particles — fixed positions to avoid SSR hydration mismatch */}
      {[
        { left: '15%', top: '20%', bg: '#6EE7F2' },
        { left: '72%', top: '35%', bg: '#DA77F2' },
        { left: '45%', top: '70%', bg: '#F2B880' },
        { left: '85%', top: '15%', bg: '#6EE7F2' },
        { left: '30%', top: '55%', bg: '#DA77F2' },
      ].map((p, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-full"
          style={{
            background: p.bg,
            left: p.left,
            top: p.top,
            filter: 'blur(1px)',
          }}
          animate={{
            y: [0, -30, 0],
            opacity: [0.2, 0.8, 0.2],
          }}
          transition={{
            duration: 3 + i,
            repeat: Infinity,
            delay: i * 0.5,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-20">
        <motion.div className="text-center space-y-16 max-w-5xl">
          {/* Title with animated reveal and glow */}
          <div className="relative py-8">
            <motion.div
              className="absolute inset-0 blur-3xl opacity-50"
              animate={{
                scale: [1, 1.1, 1],
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              style={{
                background: 'radial-gradient(circle, rgba(110, 231, 242, 0.4) 0%, rgba(218, 119, 242, 0.4) 50%, rgba(242, 184, 128, 0.4) 100%)',
              }}
            />
            <motion.h1
              className="relative text-8xl md:text-9xl font-black tracking-tight leading-none pb-8"
              initial={{ opacity: 0, filter: 'blur(20px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 1.2, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              style={{
                background: 'linear-gradient(135deg, #6EE7F2 0%, #DA77F2 50%, #F2B880 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              LLM GM
            </motion.h1>
          </div>

          {/* Subtitle */}
          <motion.p
            className="text-3xl md:text-4xl font-light tracking-wide pb-4"
            initial={{ opacity: 0, filter: 'blur(20px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 1.2, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
            style={{
              background: 'linear-gradient(90deg, #AEB7C4 0%, #E6ECF3 50%, #AEB7C4 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            AI TTRPG Game Master 
          </motion.p>

          {/* CTA Button with enhanced effects */}
          <motion.div
            initial={{ opacity: 0, filter: 'blur(20px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{
              duration: 1.2,
              delay: 1,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="pt-4"
          >
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                size="lg"
                className="relative text-2xl px-16 py-8 font-bold overflow-hidden group"
                onClick={() => router.push('/auth')}
                style={{
                  background: 'linear-gradient(135deg, #6EE7F2 0%, #DA77F2 100%)',
                  boxShadow: '0 10px 40px rgba(110, 231, 242, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset',
                }}
              >
                {/* Animated gradient overlay */}
                <motion.div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{
                    background: 'linear-gradient(135deg, #DA77F2 0%, #F2B880 100%)',
                  }}
                />

                {/* Button content */}
                <span className="relative z-10 flex items-center gap-3 text-bg-0">
                  <Sparkles className="w-6 h-6" />
                  Play Now
                  <Sparkles className="w-6 h-6" />
                </span>

                {/* Pulse effect */}
                <motion.div
                  className="absolute inset-0 rounded-lg"
                  animate={{
                    boxShadow: [
                      '0 0 20px rgba(110, 231, 242, 0.3)',
                      '0 0 60px rgba(218, 119, 242, 0.5)',
                      '0 0 20px rgba(110, 231, 242, 0.3)',
                    ],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
