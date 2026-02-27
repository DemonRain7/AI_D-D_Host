/**
 * NODE 3A: Intent-Aware RAG Context Retrieval
 *
 * Wraps the existing RAG retrieval with intent-based dynamic Top-K values.
 * A COMBAT query retrieves more items and rules; SOCIAL retrieves more NPCs.
 *
 * Fallback: returns empty arrays for all entity types on error.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import type { IntentType } from '../types/intent'
import {
  generateEmbedding,
  buildRAGQuery,
} from './rag-retrieval'
import type {
  Item,
  Location,
  Ability,
  Organization,
  Taxonomy,
  Rule,
  NPC,
} from './2-data-retrieval'

export type IntentTopK = {
  items: number
  locations: number
  abilities: number
  npcs: number
  organizations: number
  taxonomies: number
  rules: number
}

/**
 * Per-intent Top-K retrieval counts.
 * Each intent type prioritizes the entity categories most relevant to it.
 */
export const INTENT_TOP_K: Record<IntentType, IntentTopK> = {
  COMBAT: {
    items: 8,       // weapons, armor, potions nearby
    locations: 2,
    abilities: 3,   // combat abilities
    npcs: 5,        // enemies, allies
    organizations: 1,
    taxonomies: 2,
    rules: 12,      // lots of combat rules needed
  },
  SPELL_CAST: {
    items: 2,       // material components
    locations: 2,
    abilities: 10,  // lots of spell variants
    npcs: 3,
    organizations: 1,
    taxonomies: 3,
    rules: 10,      // concentration, counterspell, etc.
  },
  ITEM_USE: {
    items: 10,      // maximize item context
    locations: 2,
    abilities: 3,
    npcs: 3,
    organizations: 1,
    taxonomies: 2,
    rules: 5,
  },
  EXPLORE: {
    items: 3,
    locations: 10,  // maximize location context
    abilities: 2,
    npcs: 4,
    organizations: 3,
    taxonomies: 5,
    rules: 5,
  },
  SOCIAL: {
    items: 1,
    locations: 3,
    abilities: 2,
    npcs: 8,        // maximize NPC context
    organizations: 6, // who they belong to
    taxonomies: 3,
    rules: 5,
  },
  NARRATIVE: {
    items: 3,
    locations: 5,
    abilities: 3,
    npcs: 5,
    organizations: 5,
    taxonomies: 8,  // lore and taxonomy very relevant
    rules: 5,
  },
  META: {
    items: 0,
    locations: 0,
    abilities: 0,
    npcs: 0,
    organizations: 0,
    taxonomies: 0,
    rules: 15,      // only rules matter for meta questions
  },
}

/**
 * Per-intent similarity threshold.
 * Stricter for META (only exact rule matches), looser for COMBAT.
 */
const INTENT_THRESHOLD: Record<IntentType, number> = {
  COMBAT: 0.45,
  SPELL_CAST: 0.50,
  ITEM_USE: 0.50,
  EXPLORE: 0.45,
  SOCIAL: 0.50,
  NARRATIVE: 0.50,
  META: 0.60,
}

export type IntentAwareRAGInput = {
  playerMessage: string
  recentMessages: Array<{ author: string; content: string }>
  worldId: string
  intent: IntentType
  supabase: SupabaseClient
  openai: OpenAI
}

export type IntentAwareRAGOutput = {
  items: Item[]
  locations: Location[]
  abilities: Ability[]
  organizations: Organization[]
  taxonomies: Taxonomy[]
  rules: Rule[]
  npcs: NPC[]
  queryEmbedding: number[]
}

/**
 * Calls a Supabase match_* RPC function with the given count and threshold.
 * Returns empty array on error.
 */
async function matchEntities(
  supabase: SupabaseClient,
  funcName: string,
  worldId: string,
  embedding: number[],
  matchCount: number,
  threshold: number
): Promise<unknown[]> {
  if (matchCount === 0) return []
  try {
    const { data, error } = await supabase.rpc(funcName, {
      query_embedding: embedding,
      world_id: worldId,
      match_count: matchCount,
      match_threshold: threshold,
    })
    if (error) {
      console.warn(`[Node 3A · IntentRAG] RPC ${funcName} 出错:`, error.message)
      return []
    }
    return data ?? []
  } catch (err) {
    console.warn(`[Node 3A · IntentRAG] RPC ${funcName} 异常:`, err)
    return []
  }
}

/**
 * Retrieves world entities using intent-aware Top-K values.
 * Generates one embedding and fires all retrieval calls in parallel.
 */
export async function retrieveIntentAwareContext(
  input: IntentAwareRAGInput
): Promise<IntentAwareRAGOutput> {
  const { playerMessage, recentMessages, worldId, intent, supabase, openai } = input

  const topK = INTENT_TOP_K[intent]
  const threshold = INTENT_THRESHOLD[intent]

  let queryEmbedding: number[] = []

  try {
    const ragQuery = buildRAGQuery(playerMessage, recentMessages)
    queryEmbedding = await generateEmbedding(ragQuery, openai)
  } catch (err) {
    console.error('[Node 3A · IntentRAG] 向量生成失败:', err)
    return {
      items: [], locations: [], abilities: [], organizations: [],
      taxonomies: [], rules: [], npcs: [], queryEmbedding: [],
    }
  }

  const [items, locations, abilities, organizations, taxonomies, rules, npcs] =
    await Promise.all([
      matchEntities(supabase, 'match_items', worldId, queryEmbedding, topK.items, threshold),
      matchEntities(supabase, 'match_locations', worldId, queryEmbedding, topK.locations, threshold),
      matchEntities(supabase, 'match_abilities', worldId, queryEmbedding, topK.abilities, threshold),
      matchEntities(supabase, 'match_organizations', worldId, queryEmbedding, topK.organizations, threshold),
      matchEntities(supabase, 'match_taxonomies', worldId, queryEmbedding, topK.taxonomies, threshold),
      matchEntities(supabase, 'match_rules', worldId, queryEmbedding, topK.rules, threshold),
      matchEntities(supabase, 'match_npcs', worldId, queryEmbedding, topK.npcs, threshold),
    ])

  console.log(`[Node 3A · IntentRAG] intent=${intent} items=${items.length} locations=${locations.length} abilities=${abilities.length} npcs=${npcs.length} rules=${rules.length}`)

  return {
    items: items as Item[],
    locations: locations as Location[],
    abilities: abilities as Ability[],
    organizations: organizations as Organization[],
    taxonomies: taxonomies as Taxonomy[],
    rules: rules as Rule[],
    npcs: npcs as NPC[],
    queryEmbedding,
  }
}
