/**
 * API Route: Generate Embedding
 *
 * Generates an OpenAI embedding for entity content.
 * This is a server-side endpoint to keep the OpenAI API key secure.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateEntityEmbedding } from '@/lib/embedding-utils'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, description, aliases, additionalContext } = body

    // Validate required fields
    if (!name || !description) {
      return NextResponse.json(
        { error: 'Name and description are required' },
        { status: 400 }
      )
    }

    // Generate embedding
    const embedding = await generateEntityEmbedding({
      name,
      description,
      aliases: aliases || [],
      additionalContext,
    })

    return NextResponse.json({ embedding })
  } catch (error) {
    console.error('Embedding generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate embedding' },
      { status: 500 }
    )
  }
}
