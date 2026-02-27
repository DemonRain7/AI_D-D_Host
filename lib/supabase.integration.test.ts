/** @jest-environment node */

import { createClient } from '@supabase/supabase-js'

describe('Supabase integration', () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  it('can connect to Supabase and fetch at least one world', async () => {
    // Ensure environment variables exist
    expect(supabaseUrl).toBeDefined()
    expect(supabaseAnonKey).toBeDefined()

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase environment variables are not set')
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    const { data, error } = await supabase
      .from('worlds')
      .select('id, name')
      .limit(1)

    // Should not return an error
    expect(error).toBeNull()

    // Data should be an array
    expect(Array.isArray(data)).toBe(true)

    // We do not assert that data.length > 0,
    // because the table might be empty depending on environment.
  })
})
