/**
 * NODE 9 (formerly 5): LLM Narrative Generator
 *
 * Calls gpt-4o with streaming enabled.
 * Accepts an optional onChunk callback for SSE streaming to the client.
 * Falls back to collecting the full response if no callback provided.
 *
 * Fallback: returns a static error message on API failure (never throws).
 */

import OpenAI from 'openai'
import { SYSTEM_PROMPT } from '../prompts'
import { getTracedOpenAI } from '@/lib/langchain/client'
import { MODEL_NARRATIVE } from '@/lib/config'

export type LLMGenerationInput = {
  userPrompt: string
  openai: OpenAI
  onChunk?: (chunk: string) => void   // SSE streaming callback
}

export type LLMGenerationOutput = {
  dmResponse: string
}

const FALLBACK_RESPONSE = '地下城主陷入了沉思……（请再试一次。）'

/**
 * Generates DM narrative using gpt-4o with streaming.
 * If onChunk is provided, streams tokens in real-time.
 */
export async function generateResponse(
  input: LLMGenerationInput
): Promise<LLMGenerationOutput> {
  const { userPrompt, openai, onChunk } = input

  try {
    // Use traced client if LangSmith is configured, otherwise use passed client
    const client = getTracedOpenAI(openai.apiKey ?? undefined) ?? openai

    const stream = await client.chat.completions.create({
      model: MODEL_NARRATIVE,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: 2000,
      stream: true,
    })

    let dmResponse = ''

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        dmResponse += delta
        onChunk?.(delta)
      }
      // Detect finish reason
      const finishReason = chunk.choices[0]?.finish_reason
      if (finishReason && finishReason !== 'stop') {
        console.warn(`[Node 9 · LLMGen] 流式生成结束，原因: ${finishReason}`)
      }
    }

    if (!dmResponse) {
      console.warn('[Node 9 · LLMGen] 模型返回空响应，使用回退')
      onChunk?.(FALLBACK_RESPONSE)
      return { dmResponse: FALLBACK_RESPONSE }
    }

    console.log(`[Node 9 · LLMGen] 使用 ${MODEL_NARRATIVE} 流式生成了 ${dmResponse.length} 字符`)
    return { dmResponse }

  } catch (error) {
    console.error('[Node 9 · LLMGen] 出错，使用回退:', error)
    onChunk?.(FALLBACK_RESPONSE)
    return { dmResponse: FALLBACK_RESPONSE }
  }
}
