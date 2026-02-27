import { cn } from './utils'

describe('cn utility', () => {
  it('merges class names correctly', () => {
    const result = cn('a', 'b', false && 'c', undefined, 'd')
    expect(result).toBe('a b d')
  })

  it('handles empty input', () => {
    const result = cn()
    expect(result).toBe('')
  })
})
