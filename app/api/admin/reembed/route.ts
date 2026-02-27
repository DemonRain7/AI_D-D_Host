/**
 * POST /api/admin/reembed
 *
 * Batch-generates OpenAI embeddings for all world entities that currently
 * have a NULL embedding. Call this once after adding seed data via SQL.
 *
 * Body (all optional):
 *   worldId   – limit to one world (UUID string)
 *   table     – limit to one table name (string)
 *   batchSize – how many rows per table to process per call (default: 30)
 *
 * Example: POST /api/admin/reembed
 *          { "worldId": "xxx-yyy-zzz" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateBatchEmbeddings } from '@/lib/embedding-utils'

const EMBEDDABLE_TABLES = [
  'items',
  'npcs',
  'locations',
  'abilities',
  'rules',
  'organizations',
  'taxonomies',
] as const

type EmbeddableTable = (typeof EMBEDDABLE_TABLES)[number]

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const body = await request.json().catch(() => ({})) as {
    worldId?: string
    table?: EmbeddableTable
    batchSize?: number
  }

  const worldId    = body.worldId
  const tableFilter = body.table
  const batchSize  = body.batchSize ?? 30

  const tables = tableFilter ? [tableFilter] : [...EMBEDDABLE_TABLES]
  const summary: Record<string, { found: number; updated: number; failed: number }> = {}

  for (const table of tables) {
    summary[table] = { found: 0, updated: 0, failed: 0 }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase.from(table) as any)
        .select('id, name, description, aliases')
        .is('embedding', null)
        .limit(batchSize)

      if (worldId) query = query.eq('world_id', worldId)

      const { data: entities, error } = await query
      if (error) {
        console.error(`[reembed] Query error on ${table}:`, error.message)
        continue
      }
      if (!entities?.length) continue

      summary[table].found = entities.length

      // Generate all embeddings in one OpenAI batch call
      const embeddings = await generateBatchEmbeddings(
        entities.map((e: Record<string, unknown>) => ({
          name:        (e.name as string) ?? '',
          description: (e.description as string) ?? '',
          aliases:     (e.aliases as string[]) ?? [],
        }))
      )

      // Write back to DB — pgvector accepts a number[] via supabase-js
      for (let i = 0; i < entities.length; i++) {
        const id = (entities[i] as Record<string, unknown>).id as string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateErr } = await (supabase.from(table) as any)
          .update({ embedding: embeddings[i] })
          .eq('id', id)

        if (updateErr) {
          console.error(`[reembed] Update failed for ${table}/${id}:`, updateErr.message)
          summary[table].failed++
        } else {
          summary[table].updated++
        }
      }

      console.log(`[reembed] ${table}: ${summary[table].updated} updated, ${summary[table].failed} failed`)
    } catch (err) {
      console.error(`[reembed] Unexpected error on ${table}:`, err)
    }
  }

  const totalUpdated = Object.values(summary).reduce((s, r) => s + r.updated, 0)
  const totalFailed  = Object.values(summary).reduce((s, r) => s + r.failed, 0)
  const totalFound   = Object.values(summary).reduce((s, r) => s + r.found, 0)

  return NextResponse.json({ ok: true, totalFound, totalUpdated, totalFailed, summary })
}
