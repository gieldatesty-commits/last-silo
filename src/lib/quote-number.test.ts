import { describe, it, expect } from 'vitest'
import { buildQuoteNumber } from './quote-number'

describe('buildQuoteNumber', () => {
  it('formats as YYYY/MM/NNN with zero-padded sequence', () => {
    expect(buildQuoteNumber(new Date('2026-06-15'), 1)).toBe('2026/06/001')
    expect(buildQuoteNumber(new Date('2026-06-15'), 42)).toBe('2026/06/042')
    expect(buildQuoteNumber(new Date('2026-06-15'), 999)).toBe('2026/06/999')
  })

  it('handles month with leading zero', () => {
    expect(buildQuoteNumber(new Date('2026-01-01'), 1)).toBe('2026/01/001')
  })
})
