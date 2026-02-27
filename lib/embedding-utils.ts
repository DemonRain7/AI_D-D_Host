/**
 * Embedding Generation Utilities
 *
 * This module provides utilities for generating OpenAI embeddings
 * for world entities (items, abilities, locations, etc.)
 */

import OpenAI from 'openai'
import { EMBEDDING_MODEL } from './config'

/**
 * Generate an embedding vector for entity content.
 *
 * Combines name, aliases, and description into a single text for embedding.
 * This ensures the embedding captures all relevant information about the entity.
 *
 * @param params - Entity information
 * @returns 1536-dimensional embedding vector
 */
export async function generateEntityEmbedding(params: {
  name: string
  description: string
  aliases?: string[]
  additionalContext?: string
}): Promise<number[]> {
  const { name, description, aliases, additionalContext } = params

  // Combine all text fields for comprehensive embedding
  const textParts = [
    name,
    ...(aliases || []),
    description,
    ...(additionalContext ? [additionalContext] : []),
  ]

  const combinedText = textParts.filter(Boolean).join(' ').trim()

  if (!combinedText) {
    throw new Error('Cannot generate embedding for empty content')
  }

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  })

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: combinedText,
      dimensions: 1536,
    })

    return response.data[0].embedding
  } catch (error) {
    console.error('Failed to generate embedding:', error)
    throw new Error('Embedding generation failed')
  }
}

/**
 * Generate embeddings for multiple entities in batch.
 * More efficient than calling generateEntityEmbedding multiple times.
 *
 * @param entities - Array of entities to embed
 * @returns Array of embedding vectors in the same order
 */
export async function generateBatchEmbeddings(
  entities: Array<{
    name: string
    description: string
    aliases?: string[]
    additionalContext?: string
  }>
): Promise<number[][]> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  })

  // Prepare all texts
  const texts = entities.map((entity) => {
    const textParts = [
      entity.name,
      ...(entity.aliases || []),
      entity.description,
      ...(entity.additionalContext ? [entity.additionalContext] : []),
    ]
    return textParts.filter(Boolean).join(' ').trim()
  })

  // Validate
  if (texts.some((text) => !text)) {
    throw new Error('Cannot generate embedding for empty content')
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: 1536,
    })

    // OpenAI returns embeddings in the same order as input
    return response.data.map((item) => item.embedding)
  } catch (error) {
    console.error('Failed to generate batch embeddings:', error)
    throw new Error('Batch embedding generation failed')
  }
}

/**
 * Helper to check if OPENAI_API_KEY is configured
 */
export function isEmbeddingEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY
}
