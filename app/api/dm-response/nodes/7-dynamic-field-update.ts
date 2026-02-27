/**
 * NODE 7: Dynamic Field Update Analysis
 * Analyzes the DM response and determines if player fields need updating
 */

import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import { FIELD_UPDATE_SYSTEM_PROMPT } from '../prompts'
import { MODEL_FAST } from '@/lib/config'

export type DynamicFieldUpdateInput = {
  sessionId: string
  dmResponse: string
  playerMessage: string
  openai: OpenAI
  supabase: SupabaseClient
  /**
   * True when Node 11 already applied HP_DELTA effects this turn (combat damage/healing).
   * When true, Node 7 must NOT update hp/mp to avoid double-applying the same effect.
   * When false (e.g. item use turn), Node 7 may update hp to handle item HP costs.
   */
  hpDeltaAppliedByNode11: boolean
}

export type FieldUpdate = {
  field_name: string
  new_value: string | number | boolean
  reason?: string
}

export type DynamicFieldUpdateOutput = {
  fieldsUpdated: boolean
  updates: FieldUpdate[]
}

/**
 * Tool definition for updating player fields
 */
const UPDATE_FIELDS_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'update_player_fields',
    description: 'Update one or more player dynamic fields based on what happened in the game',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'Array of field updates to apply',
          items: {
            type: 'object',
            properties: {
              field_name: {
                type: 'string',
                description: 'The exact name of the field to update',
              },
              new_value: {
                type: ['string', 'number', 'boolean'],
                description: 'The new value for the field',
              },
              reason: {
                type: 'string',
                description: 'Brief explanation of why this field is being updated',
              },
            },
            required: ['field_name', 'new_value'],
          },
        },
      },
      required: ['updates'],
    },
  },
}

/**
 * Applies field updates to the player in the database
 */
async function applyFieldUpdates(
  supabase: SupabaseClient,
  sessionId: string,
  updates: FieldUpdate[],
): Promise<void> {
  // Get the player
  const { data: player, error: fetchError } = await supabase
    .from('players')
    .select('*')
    .eq('session_id', sessionId)
    .single()

  if (fetchError || !player) {
    console.error('[Node 7 · FieldUpdate] 获取玩家数据失败:', fetchError)
    return
  }

  // Safety guard: ALWAYS block HP/MP updates — these are managed exclusively by Node 11.
  // Even if Node 11 didn't fire this turn, HP/MP in world_player_fields should stay in sync
  // with player_core_stats (the authoritative source), not be updated by LLM guesses.
  {
    const HP_MP_FIELDS = new Set(['hp', 'HP', 'mp', 'MP', '生命值', '法力值', 'mana', 'health'])
    const safeUpdates = updates.filter(u => {
      if (HP_MP_FIELDS.has(u.field_name)) {
        console.warn(`[Node 7 · FieldUpdate] ⚠️ 拒绝更新 "${u.field_name}" (HP/MP由Node 11专管)，跳过`)
        return false
      }
      return true
    })
    if (safeUpdates.length === 0) {
      console.log('[Node 7 · FieldUpdate] 过滤后无需更新字段')
      return
    }
    updates = safeUpdates
  }

  // Apply updates to dynamic_fields
  const currentFields = (player.dynamic_fields as Record<string, unknown> || {})
  const updatedFields = { ...currentFields }

  updates.forEach(update => {
    const oldValue = currentFields[update.field_name]
    updatedFields[update.field_name] = update.new_value
    console.log(`[Node 7 · FieldUpdate] ${update.field_name}: ${oldValue} → ${update.new_value} (${update.reason ?? '无原因'})`)
  })

  // Save back to database
  const { error: updateError } = await supabase
    .from('players')
    .update({
      dynamic_fields: updatedFields,
      updated_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId)

  if (updateError) {
    console.error('[Node 7 · FieldUpdate] 更新玩家字段失败:', updateError)
  } else {
    console.log(`[Node 7 · FieldUpdate] 已写入数据库，字段: ${JSON.stringify(updatedFields)}`)
  }

  // HP/MP sync to player_core_stats is no longer needed here:
  // - HP/MP fields are filtered out before reaching this function (never updated by Node 7)
  // - player_core_stats is the sole authoritative source, managed exclusively by Node 11
}

/**
 * Analyzes DM response and updates player fields if needed
 */
export async function analyzeDynamicFieldUpdates(
  input: DynamicFieldUpdateInput
): Promise<DynamicFieldUpdateOutput> {
  const { sessionId, dmResponse, playerMessage, openai, supabase } = input

  try {
    // Fetch current player state and field definitions
    const [
      { data: player },
      { data: session },
    ] = await Promise.all([
      supabase.from('players').select('*').eq('session_id', sessionId).single(),
      supabase.from('sessions').select('world_id').eq('id', sessionId).single(),
    ])

    if (!player || !session) {
      return { fieldsUpdated: false, updates: [] }
    }

    // Fetch player field definitions
    const { data: playerFields } = await supabase
      .from('world_player_fields')
      .select('*')
      .eq('world_id', session.world_id)
      .order('display_order')

    if (!playerFields || playerFields.length === 0) {
      return { fieldsUpdated: false, updates: [] }
    }

    // Filter out hp/mp fields — these are managed exclusively by player_core_stats + Node 11.
    // Showing them to the LLM only causes confusion (LLM tries to update them).
    const HP_MP_FIELD_NAMES = /^(hp|mp|生命值|法力值|mana|health)$/i
    const safePlayerFields = playerFields.filter(
      (f: { field_name: string }) => !HP_MP_FIELD_NAMES.test(f.field_name)
    )

    if (safePlayerFields.length === 0) {
      return { fieldsUpdated: false, updates: [] }
    }

    // Build context about current fields (hp/mp excluded)
    const currentFieldsContext = safePlayerFields
      .map((field: { field_name: string; field_type: string; default_value: string | null }) => {
        const currentValue = (player.dynamic_fields as Record<string, unknown>)?.[field.field_name]
        const displayValue = currentValue ?? field.default_value ?? '未设置'
        return `- ${field.field_name} (类型: ${field.field_type}, 当前值: ${displayValue})`
      })
      .join('\n')

    // Call LLM to determine if fields should be updated
    const completion = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        {
          role: 'system',
          content: FIELD_UPDATE_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: `分析以下游戏交互，判断玩家的哪些字段需要更新。

玩家当前字段及数值：
${currentFieldsContext}

玩家行动：
${playerMessage}

DM叙述：
${dmResponse}

根据DM叙述中描述的事件，判断是否有字段需要更新。如果需要更新，调用 update_player_fields 函数。如果不需要，不要调用任何函数。
注意：number类型字段的new_value必须是数字，text类型字段的new_value必须是字符串。`,
        },
      ],
      tools: [UPDATE_FIELDS_TOOL],
      tool_choice: 'auto',
    })

    const message = completion.choices[0]?.message

    // Check if LLM called the tool
    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0]

      if ('function' in toolCall && toolCall.function.name === 'update_player_fields') {
        const args = JSON.parse(toolCall.function.arguments)
        const updates: FieldUpdate[] = args.updates || []

        if (updates.length > 0) {
          // Apply the updates to the database
          await applyFieldUpdates(supabase, sessionId, updates)

          console.log(`[Node 7 · FieldUpdate] 更新了 ${updates.length} 个玩家字段:`, updates)

          return {
            fieldsUpdated: true,
            updates,
          }
        }
      }
    }

    // No updates needed
    return { fieldsUpdated: false, updates: [] }

  } catch (error) {
    console.error('[Node 7 · FieldUpdate] 分析动态字段更新出错:', error)
    return { fieldsUpdated: false, updates: [] }
  }
}
