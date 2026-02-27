/**
 * NODE 6: Output Persistence
 * Saves the DM response to the database
 */

import { SupabaseClient } from '@supabase/supabase-js'

export type OutputPersistenceInput = {
  sessionId: string
  dmResponse: string
  supabase: SupabaseClient
}

export type OutputPersistenceOutput = {
  dmResponse: string
  messageId: string | null
}

/**
 * Saves the DM response to the database and returns output
 */
export async function persistOutput(
  input: OutputPersistenceInput
): Promise<OutputPersistenceOutput> {
  const { sessionId, dmResponse, supabase } = input

  const { data: message, error } = await supabase
    .from('session_messages')
    .insert({
      session_id: sessionId,
      author: 'dm',
      content: dmResponse,
    })
    .select()
    .single()

  if (error) {
    console.error('[Node 10 · Persist] 保存DM消息出错:', error)
    // Still return the response even if saving fails
  }

  return {
    dmResponse,
    messageId: message?.id || null,
  }
}
