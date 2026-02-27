/**
 * LangSmith-traced OpenAI client
 *
 * Wraps the OpenAI SDK to automatically trace all calls to LangSmith.
 * Configure with LANGCHAIN_TRACING_V2=true and LANGSMITH_API_KEY in .env.local.
 * If LANGCHAIN_TRACING_V2 is not set, operates normally without tracing.
 */

import OpenAI from 'openai'

let _tracedClient: OpenAI | null = null

/**
 * Returns an OpenAI client, optionally wrapped with LangSmith tracing.
 * Wrapping is lazy — only attempted if langsmith package is available and tracing is enabled.
 */
export function getTracedOpenAI(apiKey?: string): OpenAI {
  if (_tracedClient) return _tracedClient

  const client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY })

  if (process.env.LANGCHAIN_TRACING_V2 === 'true' && process.env.LANGSMITH_API_KEY) {
    try {
      // Dynamic import to avoid crashing if langsmith is not installed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { wrapOpenAI } = require('langsmith/wrappers')
      _tracedClient = wrapOpenAI(client)
      console.log('[LangSmith] Tracing enabled for OpenAI calls')
      return _tracedClient!
    } catch {
      console.warn('[LangSmith] langsmith package not found, tracing disabled')
    }
  }

  _tracedClient = client
  return _tracedClient!
}

/**
 * Reset the cached client (useful for testing).
 */
export function resetTracedClient(): void {
  _tracedClient = null
}
