/**
 * Batch Embedding Generation Script
 *
 * This script generates embeddings for existing entities that don't have them yet.
 * Run this script when you have historical data that needs embeddings.
 *
 * Usage:
 *   npx tsx scripts/generate-embeddings.ts
 *
 * Or add to package.json scripts:
 *   "generate-embeddings": "tsx scripts/generate-embeddings.ts"
 */

import { createClient } from '@supabase/supabase-js'
import { generateBatchEmbeddings } from '../lib/embedding-utils'

// Configuration
const BATCH_SIZE = 50 // Process 50 entities at a time
const TABLES = [
  'items',
  'abilities',
  'locations',
  'npcs',
  'organizations',
  'taxonomies',
  'rules',
] as const

// Initialize Supabase client with service role key for admin access
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type EntityTable = (typeof TABLES)[number]

interface Entity {
  id: string
  name: string
  description: string
  aliases?: string[]
  personality?: string
  motivations?: string
}

/**
 * Generate embeddings for all entities in a specific table
 */
async function generateEmbeddingsForTable(tableName: EntityTable) {
  console.log(`\n📋 Processing table: ${tableName}`)
  console.log('─'.repeat(60))

  // Get all entities without embeddings
  const { data: entities, error: fetchError } = await supabase
    .from(tableName)
    .select('id, name, description, aliases, personality, motivations')
    .is('embedding', null)

  if (fetchError) {
    console.error(`❌ Failed to fetch entities from ${tableName}:`, fetchError)
    return
  }

  if (!entities || entities.length === 0) {
    console.log(`✅ All entities in ${tableName} already have embeddings`)
    return
  }

  console.log(`🔍 Found ${entities.length} entities without embeddings`)

  let processed = 0
  let succeeded = 0
  let failed = 0

  // Process in batches
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE) as Entity[]
    console.log(
      `\n⚙️  Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(entities.length / BATCH_SIZE)} (${batch.length} entities)...`
    )

    try {
      // Prepare entity data for embedding generation
      const entityData = batch.map((entity) => ({
        name: entity.name,
        description: entity.description,
        aliases: entity.aliases || [],
        // For NPCs, include personality and motivations
        additionalContext:
          tableName === 'npcs'
            ? [entity.personality, entity.motivations].filter(Boolean).join(' ')
            : undefined,
      }))

      // Generate embeddings in batch
      const embeddings = await generateBatchEmbeddings(entityData)

      // Update database with embeddings
      for (let j = 0; j < batch.length; j++) {
        const entity = batch[j]
        const embedding = embeddings[j]

        const { error: updateError } = await supabase
          .from(tableName)
          .update({ embedding })
          .eq('id', entity.id)

        if (updateError) {
          console.error(`  ❌ Failed to update ${entity.name}:`, updateError.message)
          failed++
        } else {
          console.log(`  ✓ ${entity.name}`)
          succeeded++
        }

        processed++
      }
    } catch (error) {
      console.error(`❌ Batch processing error:`, error)
      failed += batch.length
      processed += batch.length
    }

    // Progress update
    console.log(
      `📊 Progress: ${processed}/${entities.length} (${succeeded} succeeded, ${failed} failed)`
    )

    // Rate limiting: wait 1 second between batches to avoid hitting API limits
    if (i + BATCH_SIZE < entities.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  console.log(`\n✅ ${tableName}: ${succeeded}/${entities.length} embeddings generated`)
  if (failed > 0) {
    console.log(`⚠️  ${failed} entities failed`)
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('🚀 Batch Embedding Generation Script')
  console.log('=' .repeat(60))

  // Validate environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL is not set')
    process.exit(1)
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY is not set')
    process.exit(1)
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is not set')
    process.exit(1)
  }

  const startTime = Date.now()

  // Process each table
  for (const table of TABLES) {
    try {
      await generateEmbeddingsForTable(table)
    } catch (error) {
      console.error(`❌ Error processing ${table}:`, error)
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log('\n' + '='.repeat(60))
  console.log(`🎉 Batch embedding generation completed in ${duration}s`)
  console.log('='.repeat(60))
}

// Run the script
main().catch((error) => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
