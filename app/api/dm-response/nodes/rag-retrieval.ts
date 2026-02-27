/**
 * RAG (Retrieval-Augmented Generation) Utilities
 *
 * This module provides tools for semantic search using vector embeddings.
 * Instead of retrieving ALL entities from the database, we use vector similarity
 * to retrieve only the most relevant entities based on the player's message.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { EMBEDDING_MODEL } from '@/lib/config'
import type {
  Item,
  Location,
  Ability,
  Organization,
  Taxonomy,
  Rule,
  NPC,
} from './2-data-retrieval'

// ============================================================================
// RAG Configuration
// ============================================================================

export const RAG_CONFIG = {
  /**
   * Number of most relevant entities to retrieve per category.
   * Lower numbers = faster, cheaper, but might miss context
   * Higher numbers = more context, but higher cost and latency
   */
  TOP_K: {
    items: 5,
    locations: 5,
    abilities: 5,
    npcs: 5,
    organizations: 5,
    taxonomies: 5,
    rules: 10, // Rules might need more coverage
  },

  /**
   * Similarity threshold (0-1).
   * Only entities with similarity >= threshold will be included.
   *
   * 0.9+ = Very high similarity (might be too strict)
   * 0.7-0.8 = Good balance (recommended)
   * 0.5-0.6 = Loose matching (might include irrelevant results)
   */
  SIMILARITY_THRESHOLD: 0.50,

  /**
   * OpenAI embedding model — centralised in lib/config.ts.
   * text-embedding-3-small produces 1536-dimensional vectors (same as ada-002).
   */
  EMBEDDING_MODEL: EMBEDDING_MODEL,

  /**
   * Enable RAG for specific entity types.
   * Set to false to fall back to full retrieval for that type.
   */
  ENABLE_RAG: {
    items: true,
    locations: true,
    abilities: true,
    npcs: true,
    organizations: true,
    taxonomies: true,
    rules: true,
  },
}

// ============================================================================
// Core RAG Functions
// ============================================================================

/**
 * Generate an embedding vector for a given text using OpenAI.
 *
 * @param text - The text to embed
 * @param openai - OpenAI client instance
 * @returns 1536-dimensional embedding vector
 */
export async function generateEmbedding(
  text: string,
  openai: OpenAI
): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: RAG_CONFIG.EMBEDDING_MODEL,
      input: text.trim(),
      dimensions: 1536,
    })
    return response.data[0].embedding
  } catch (error) {
    console.error('[Node 2A · RAG] 向量生成失败:', error)
    throw new Error('Embedding generation failed')
  }
}

/**
 * Build a rich query context from player message and recent conversation history.
 * This improves retrieval accuracy by providing more context.
 *
 * @param playerMessage - Current player message
 * @param recentMessages - Recent conversation history
 * @returns Combined query string for embedding
 */
export function buildRAGQuery(
  playerMessage: string,
  recentMessages: { author: string; content: string }[]
): string {
  // Take last 3 messages for context (not including the current one)
  const conversationContext = recentMessages
    .slice(-3)
    .map((m) => `${m.author === 'player' ? 'Player' : 'DM'}: ${m.content}`)
    .join('\n')

  // Combine conversation context with current message
  if (conversationContext) {
    return `${conversationContext}\nPlayer: ${playerMessage}`
  }

  return `Player: ${playerMessage}`
}

// ============================================================================
// Entity-Specific RAG Retrieval Functions
// ============================================================================

/**
 * Retrieve relevant items using vector similarity search
 */
export async function retrieveRelevantItems(
  supabase: SupabaseClient,
  worldId: string,
  queryEmbedding: number[]
): Promise<Item[]> {
  if (!RAG_CONFIG.ENABLE_RAG.items) {
    // Fallback to full retrieval
    const { data } = await supabase
      .from('items')
      .select('*')
      .eq('world_id', worldId)
    return data || []
  }

  const { data, error } = await supabase.rpc('match_items', {
    query_embedding: queryEmbedding,
    world_id: worldId,
    match_count: RAG_CONFIG.TOP_K.items,
    match_threshold: RAG_CONFIG.SIMILARITY_THRESHOLD,
  })

  if (error) {
    console.error('[Node 2A · RAG] 检索道具出错:', error)
    return []
  }

  return data || []
}

/**
 * Retrieve relevant locations using vector similarity search
 */
export async function retrieveRelevantLocations(
  supabase: SupabaseClient,
  worldId: string,
  queryEmbedding: number[]
): Promise<Location[]> {
  if (!RAG_CONFIG.ENABLE_RAG.locations) {
    const { data } = await supabase
      .from('locations')
      .select('*')
      .eq('world_id', worldId)
    return data || []
  }

  const { data, error } = await supabase.rpc('match_locations', {
    query_embedding: queryEmbedding,
    world_id: worldId,
    match_count: RAG_CONFIG.TOP_K.locations,
    match_threshold: RAG_CONFIG.SIMILARITY_THRESHOLD,
  })

  if (error) {
    console.error('[Node 2A · RAG] 检索地点出错:', error)
    return []
  }

  return data || []
}

/**
 * Retrieve relevant abilities using vector similarity search
 */
export async function retrieveRelevantAbilities(
  supabase: SupabaseClient,
  worldId: string,
  queryEmbedding: number[]
): Promise<Ability[]> {
  if (!RAG_CONFIG.ENABLE_RAG.abilities) {
    const { data } = await supabase
      .from('abilities')
      .select('*')
      .eq('world_id', worldId)
    return data || []
  }

  const { data, error } = await supabase.rpc('match_abilities', {
    query_embedding: queryEmbedding,
    world_id: worldId,
    match_count: RAG_CONFIG.TOP_K.abilities,
    match_threshold: RAG_CONFIG.SIMILARITY_THRESHOLD,
  })

  if (error) {
    console.error('[Node 2A · RAG] 检索能力出错:', error)
    return []
  }

  return data || []
}

/**
 * Retrieve relevant NPCs using vector similarity search
 */
export async function retrieveRelevantNPCs(
  supabase: SupabaseClient,
  worldId: string,
  queryEmbedding: number[]
): Promise<NPC[]> {
  if (!RAG_CONFIG.ENABLE_RAG.npcs) {
    const { data } = await supabase
      .from('npcs')
      .select('*')
      .eq('world_id', worldId)
    return data || []
  }

  const { data, error } = await supabase.rpc('match_npcs', {
    query_embedding: queryEmbedding,
    world_id: worldId,
    match_count: RAG_CONFIG.TOP_K.npcs,
    match_threshold: RAG_CONFIG.SIMILARITY_THRESHOLD,
  })

  if (error) {
    console.error('[Node 2A · RAG] 检索NPC出错:', error)
    return []
  }

  return data || []
}

/**
 * Retrieve relevant organizations using vector similarity search
 */
export async function retrieveRelevantOrganizations(
  supabase: SupabaseClient,
  worldId: string,
  queryEmbedding: number[]
): Promise<Organization[]> {
  if (!RAG_CONFIG.ENABLE_RAG.organizations) {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .eq('world_id', worldId)
    return data || []
  }

  const { data, error } = await supabase.rpc('match_organizations', {
    query_embedding: queryEmbedding,
    world_id: worldId,
    match_count: RAG_CONFIG.TOP_K.organizations,
    match_threshold: RAG_CONFIG.SIMILARITY_THRESHOLD,
  })

  if (error) {
    console.error('[Node 2A · RAG] 检索组织出错:', error)
    return []
  }

  return data || []
}

/**
 * Retrieve relevant taxonomies using vector similarity search
 */
export async function retrieveRelevantTaxonomies(
  supabase: SupabaseClient,
  worldId: string,
  queryEmbedding: number[]
): Promise<Taxonomy[]> {
  if (!RAG_CONFIG.ENABLE_RAG.taxonomies) {
    const { data } = await supabase
      .from('taxonomies')
      .select('*')
      .eq('world_id', worldId)
    return data || []
  }

  const { data, error } = await supabase.rpc('match_taxonomies', {
    query_embedding: queryEmbedding,
    world_id: worldId,
    match_count: RAG_CONFIG.TOP_K.taxonomies,
    match_threshold: RAG_CONFIG.SIMILARITY_THRESHOLD,
  })

  if (error) {
    console.error('[Node 2A · RAG] 检索分类出错:', error)
    return []
  }

  return data || []
}

/**
 * Retrieve relevant rules using vector similarity search
 */
export async function retrieveRelevantRules(
  supabase: SupabaseClient,
  worldId: string,
  queryEmbedding: number[]
): Promise<Rule[]> {
  if (!RAG_CONFIG.ENABLE_RAG.rules) {
    const { data } = await supabase
      .from('rules')
      .select('*')
      .eq('world_id', worldId)
    return data || []
  }

  const { data, error } = await supabase.rpc('match_rules', {
    query_embedding: queryEmbedding,
    world_id: worldId,
    match_count: RAG_CONFIG.TOP_K.rules,
    match_threshold: RAG_CONFIG.SIMILARITY_THRESHOLD,
  })

  if (error) {
    console.error('[Node 2A · RAG] 检索规则出错:', error)
    return []
  }

  return data || []
}
