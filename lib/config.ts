/**
 * Central model configuration.
 * To switch models for the entire project, change these constants.
 * Override via environment variables for per-deployment flexibility.
 */

/** Primary model — used for streaming narrative generation (Node 9) */
export const MODEL_NARRATIVE = process.env.LLM_MODEL_NARRATIVE ?? 'gpt-4.1'

/**
 * Fast model — used for tool-calling tasks: intent classification, event generation,
 * field updates, story completion (Nodes 2, 3C, 7, 17).
 * MUST support OpenAI function calling / tool_choice.
 */
export const MODEL_FAST = process.env.LLM_MODEL_FAST ?? 'gpt-4.1'

/**
 * Embedding model — used for vectorizing entities and player queries.
 * text-embedding-3-small: 1536-dim, cheaper and more accurate than ada-002.
 * NOTE: Changing this requires re-embedding ALL existing entities in the DB
 *       via POST /api/admin/reembed (different vector spaces are incompatible).
 */
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'
