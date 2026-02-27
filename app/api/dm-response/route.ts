import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import { executeDMResponseWorkflow } from './workflow'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/**
 * POST /api/dm-response
 *
 * Returns a Server-Sent Events (SSE) stream.
 *
 * Event types:
 *   data: {"type":"meta","event":"intent","data":{...}}   ← intent classification result
 *   data: {"type":"meta","event":"dice","data":{...}}     ← dice roll result
 *   data: {"type":"meta","event":"outcome","data":{...}}  ← outcome type
 *   data: {"type":"delta","content":"..."}                ← narrative text chunk
 *   data: {"type":"done","messageId":"..."}               ← stream complete
 *   data: {"type":"error","message":"..."}                ← error
 */
export async function POST(request: NextRequest) {
  let sessionId: string | undefined
  let playerMessage: string | undefined

  try {
    const body = await request.json()
    sessionId = body.sessionId
    playerMessage = body.playerMessage
  } catch {
    return new Response(
      'data: {"type":"error","message":"Invalid JSON body"}\n\ndata: {"type":"done","messageId":null}\n\n',
      { status: 400, headers: sseHeaders() }
    )
  }

  const supabase = await createClient()

  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      function send(payload: unknown) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          // Controller may be closed if client disconnected
        }
      }

      try {
        const { messageId } = await executeDMResponseWorkflow({
          sessionId,
          playerMessage,
          supabase,
          openai,
          onChunk: (chunk) => {
            send({ type: 'delta', content: chunk })
          },
          onMeta: (meta) => {
            send({ type: 'meta', event: meta.type, data: meta.data })
          },
        })

        send({ type: 'done', messageId })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error'
        send({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: sseHeaders() })
}

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
}
