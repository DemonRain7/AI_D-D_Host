/**
 * Standalone embedding script — no dev server needed.
 *
 * Usage:
 *   node scripts/reembed.mjs                      # all worlds
 *   node scripts/reembed.mjs <worldId>             # specific world
 *
 * Reads OPENAI_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * from .env.local (via dotenv-style manual parsing).
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── Parse .env.local ────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env.local')

function loadEnv(filePath) {
  const vars = {}
  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      // strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      vars[key] = val
    }
  } catch { /* ignore missing file */ }
  return vars
}

const env = loadEnv(envPath)
const OPENAI_API_KEY        = env.OPENAI_API_KEY        || process.env.OPENAI_API_KEY
const SUPABASE_URL          = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const EMBEDDING_MODEL       = env.EMBEDDING_MODEL || 'text-embedding-3-small'

// ── Validate ────────────────────────────────────────────────────────────
if (!OPENAI_API_KEY)       { console.error('❌ Missing OPENAI_API_KEY in .env.local');        process.exit(1) }
if (!SUPABASE_URL)         { console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL in .env.local'); process.exit(1) }
if (!SUPABASE_SERVICE_KEY) { console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY in .env.local — add it from Supabase Dashboard > Settings > API > service_role key'); process.exit(1) }

// ── Init clients ────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const openai   = new OpenAI({ apiKey: OPENAI_API_KEY })

const TABLES = ['items', 'npcs', 'locations', 'abilities', 'rules', 'organizations', 'taxonomies']
const BATCH_SIZE = 30
const worldId = process.argv[2] || null

console.log(`\n=== Reembed Script ===`)
console.log(`Model:    ${EMBEDDING_MODEL}`)
console.log(`Supabase: ${SUPABASE_URL}`)
console.log(`World:    ${worldId || '(all worlds)'}`)
console.log('')

let totalFound = 0, totalUpdated = 0, totalFailed = 0

for (const table of TABLES) {
  let query = supabase
    .from(table)
    .select('id, name, description, aliases')
    .is('embedding', null)
    .limit(BATCH_SIZE)

  if (worldId) query = query.eq('world_id', worldId)

  const { data: entities, error } = await query
  if (error) {
    console.error(`  [${table}] Query error: ${error.message}`)
    continue
  }
  if (!entities?.length) {
    console.log(`  [${table}] No null embeddings found — skip`)
    continue
  }

  totalFound += entities.length
  console.log(`  [${table}] Found ${entities.length} entities without embedding`)

  // Build text for each entity
  const texts = entities.map(e => {
    const parts = [e.name, ...(e.aliases || []), e.description].filter(Boolean)
    return parts.join(' ').trim()
  })

  // Call OpenAI batch embedding
  let embeddings
  try {
    const resp = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts, dimensions: 1536 })
    embeddings = resp.data.map(d => d.embedding)
  } catch (err) {
    console.error(`  [${table}] OpenAI embedding failed: ${err.message}`)
    totalFailed += entities.length
    continue
  }

  // Write back to DB
  let updated = 0, failed = 0
  for (let i = 0; i < entities.length; i++) {
    const { error: updateErr } = await supabase
      .from(table)
      .update({ embedding: embeddings[i] })
      .eq('id', entities[i].id)

    if (updateErr) {
      console.error(`    ✗ ${entities[i].name}: ${updateErr.message}`)
      failed++
    } else {
      console.log(`    ✓ ${entities[i].name}`)
      updated++
    }
  }

  totalUpdated += updated
  totalFailed += failed
}

console.log(`\n=== Done ===`)
console.log(`Found: ${totalFound}  Updated: ${totalUpdated}  Failed: ${totalFailed}\n`)
