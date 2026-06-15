export function applyMarkup(basePrice: number, markupPct: number): number {
  return basePrice * (1 + markupPct / 100)
}

export function calcItemTotal(quantity: number, unitPrice: number): number {
  return quantity * unitPrice
}

export function calcQuoteTotals(
  items: { quantity: number; unitPrice: number }[]
): { netTotal: number; vat: number; grossTotal: number } {
  const netTotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  )
  const vat = netTotal * 0.23
  const grossTotal = netTotal + vat
  return { netTotal, vat, grossTotal }
}
