/**
 * NODE 2: Data Retrieval
 * Fetches all necessary data from the database
 * Now uses RAG (Retrieval-Augmented Generation) for selective context retrieval
 */

import { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import {
  generateEmbedding,
  buildRAGQuery,
  retrieveRelevantItems,
  retrieveRelevantLocations,
  retrieveRelevantAbilities,
  retrieveRelevantNPCs,
  retrieveRelevantOrganizations,
  retrieveRelevantTaxonomies,
  retrieveRelevantRules,
} from './rag-retrieval'

export type DataRetrievalInput = {
  sessionId: string
  playerMessage: string
  supabase: SupabaseClient
  openai: OpenAI
}

export type World = {
  id: string
  name: string
  tone?: string
  description: string
  setting: string
}

export type Session = {
  id: string
  worlds: World
}

export type Item = {
  id?: string
  name: string
  description: string
  aliases?: string[]
  is_unique?: boolean
  item_stats?: Record<string, unknown> | null
  location_id?: string | null
  unlock_node_id?: string | null
}

export type Location = {
  id?: string
  name: string
  description: string
  aliases?: string[]
}

export type AbilityStats = {
  mp_cost: number
  damage: number
  hp_restore: number
  effect_type: 'spell' | 'passive' | 'active' | 'toggle'
}

export type Ability = {
  id?: string
  name: string
  description: string
  aliases?: string[]
  ability_stats?: AbilityStats | null
}

export type Organization = {
  name: string
  description: string
  aliases?: string[]
}

export type Taxonomy = {
  name: string
  description: string
  aliases?: string[]
}

export type Rule = {
  name: string
  description: string
  aliases?: string[]
  priority?: boolean
}

export type NpcCombatStats = {
  hp: number
  max_hp: number
  mp: number
  max_mp: number
  attack: number
  defense: number
  is_hostile: boolean
}

export type NPC = {
  id?: string
  name: string
  description: string
  aliases?: string[]
  personality?: string
  motivations?: string
  combat_stats?: NpcCombatStats | null
}

export type PlayerField = {
  field_name: string
  field_type: string
  is_hidden?: boolean
}

export type Player = {
  name: string
  appearance: string
  state?: string
  dynamic_fields?: Record<string, unknown>
}

export type Message = {
  author: string
  content: string
  created_at: string
}

export type DataRetrievalOutput = {
  world: World
  items: Item[] | null
  locations: Location[] | null
  abilities: Ability[] | null
  organizations: Organization[] | null
  taxonomies: Taxonomy[] | null
  rules: Rule[] | null
  playerFields: PlayerField[] | null
  npcs: NPC[] | null
  player: Player | null
  messageHistory: Message[] | null
}

/**
 * Retrieves all data needed for DM response generation
 * Uses RAG (vector similarity search) to retrieve only relevant entities
 */
export async function retrieveData(
  input: DataRetrievalInput
): Promise<DataRetrievalOutput> {
  const { sessionId, playerMessage, supabase, openai } = input

  // Get session and world data
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select(`
      *,
      worlds (*)
    `)
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    throw new Error('Session not found')
  }

  const world = (session as Session).worlds

  // First, fetch message history (needed for building RAG query context)
  const { data: messageHistory } = await supabase
    .from('session_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(5)

  // Build RAG query from player message + recent conversation
  const ragQuery = buildRAGQuery(playerMessage, messageHistory || [])

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(ragQuery, openai)

  // Fetch data in parallel using RAG for entity retrieval
  const [
    items,
    locations,
    abilities,
    organizations,
    taxonomies,
    rules,
    npcs,
    { data: playerFields },
    { data: player },
  ] = await Promise.all([
    // RAG-based retrieval (only relevant entities)
    retrieveRelevantItems(supabase, world.id, queryEmbedding),
    retrieveRelevantLocations(supabase, world.id, queryEmbedding),
    retrieveRelevantAbilities(supabase, world.id, queryEmbedding),
    retrieveRelevantOrganizations(supabase, world.id, queryEmbedding),
    retrieveRelevantTaxonomies(supabase, world.id, queryEmbedding),
    retrieveRelevantRules(supabase, world.id, queryEmbedding),
    retrieveRelevantNPCs(supabase, world.id, queryEmbedding),

    // Non-RAG retrieval (these are small or always needed)
    supabase.from('world_player_fields').select('*').eq('world_id', world.id),
    supabase.from('players').select('*').eq('session_id', sessionId).single(),
  ])

  // RAG Debug Output - Log retrieved entities to terminal
  console.log('\n' + '='.repeat(80))
  console.log('[Node 2A · DataRetrieval] RAG 检索结果')
  console.log('='.repeat(80))
  console.log(`[Node 2A · DataRetrieval] 查询: "${playerMessage}"`)
  console.log(`[Node 2A · DataRetrieval] 世界: ${world.name}`)
  console.log('-'.repeat(80))

  const TAG = '[Node 2A · DataRetrieval]'

  console.log(`${TAG} 道具 (${items.length}):`)
  items.forEach((item: { name: string; similarity?: number }, i: number) => {
    console.log(`  ${i + 1}. ${item.name}${item.similarity ? ` (相似度: ${item.similarity.toFixed(3)})` : ''}`)
  })

  console.log(`${TAG} 能力 (${abilities.length}):`)
  abilities.forEach((ability: { name: string; similarity?: number }, i: number) => {
    console.log(`  ${i + 1}. ${ability.name}${ability.similarity ? ` (相似度: ${ability.similarity.toFixed(3)})` : ''}`)
  })

  console.log(`${TAG} 地点 (${locations.length}):`)
  locations.forEach((location: { name: string; similarity?: number }, i: number) => {
    console.log(`  ${i + 1}. ${location.name}${location.similarity ? ` (相似度: ${location.similarity.toFixed(3)})` : ''}`)
  })

  console.log(`${TAG} NPCs (${npcs.length}):`)
  npcs.forEach((npc: { name: string; similarity?: number }, i: number) => {
    console.log(`  ${i + 1}. ${npc.name}${npc.similarity ? ` (相似度: ${npc.similarity.toFixed(3)})` : ''}`)
  })

  console.log(`${TAG} 组织 (${organizations.length}):`)
  organizations.forEach((org: { name: string; similarity?: number }, i: number) => {
    console.log(`  ${i + 1}. ${org.name}${org.similarity ? ` (相似度: ${org.similarity.toFixed(3)})` : ''}`)
  })

  console.log(`${TAG} 分类 (${taxonomies.length}):`)
  taxonomies.forEach((tax: { name: string; similarity?: number }, i: number) => {
    console.log(`  ${i + 1}. ${tax.name}${tax.similarity ? ` (相似度: ${tax.similarity.toFixed(3)})` : ''}`)
  })

  console.log(`${TAG} 规则 (${rules.length}):`)
  rules.forEach((rule: { name: string; similarity?: number }, i: number) => {
    console.log(`  ${i + 1}. ${rule.name}${rule.similarity ? ` (相似度: ${rule.similarity.toFixed(3)})` : ''}`)
  })

  console.log(`${TAG} 实体总数: ${items.length + abilities.length + locations.length + npcs.length + organizations.length + taxonomies.length + rules.length}`)
  console.log('='.repeat(80))

  return {
    world,
    items,
    locations,
    abilities,
    organizations,
    taxonomies,
    rules,
    playerFields,
    npcs,
    player,
    messageHistory,
  }
}
