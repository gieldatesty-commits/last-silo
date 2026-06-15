import { describe, it, expect } from 'vitest'
import { applyMarkup, calcItemTotal, calcQuoteTotals } from './calc'

describe('applyMarkup', () => {
  it('applies markup percentage to base price', () => {
    expect(applyMarkup(100, 20)).toBe(120)
  })

  it('returns base price when markup is 0', () => {
    expect(applyMarkup(100, 0)).toBe(100)
  })
})

describe('calcItemTotal', () => {
  it('multiplies quantity by unit price', () => {
    expect(calcItemTotal(5, 120)).toBe(600)
  })
})

describe('calcQuoteTotals', () => {
  const items = [
    { quantity: 10, unitPrice: 102 },
    { quantity: 6, unitPrice: 144 },
  ]

  it('calculates net total', () => {
    const { netTotal } = calcQuoteTotals(items)
    expect(netTotal).toBe(1884)
  })

  it('calculates VAT at 23%', () => {
    const { vat } = calcQuoteTotals(items)
    expect(vat).toBeCloseTo(433.32, 2)
  })

  it('calculates gross total', () => {
    const { grossTotal } = calcQuoteTotals(items)
    expect(grossTotal).toBeCloseTo(2317.32, 2)
  })
})
