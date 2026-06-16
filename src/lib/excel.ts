import * as XLSX from 'xlsx'
import { calcQuoteTotals } from './calc'

type Item = { name: string; quantity: number; unit: string; unitPrice: number }

type QuoteData = {
  number: string
  clientName: string
  clientAddr: string
  items: Item[]
}

export function buildQuoteExcel(quote: QuoteData): Buffer {
  const totals = calcQuoteTotals(quote.items)

  const rows = [
    [`Oferta nr: ${quote.number}`],
    [`Klient: ${quote.clientName}`, '', `Adres: ${quote.clientAddr}`],
    [],
    ['Pozycja', 'Ilość', 'J.m.', 'Cena jednostkowa netto', 'Wartość netto'],
    ...quote.items.map((item) => [
      item.name,
      item.quantity,
      item.unit,
      item.unitPrice,
      item.quantity * item.unitPrice,
    ]),
    [],
    ['', '', '', 'Razem netto:', totals.netTotal],
    ['', '', '', 'VAT 23%:', totals.vat],
    ['', '', '', 'Razem brutto:', totals.grossTotal],
  ]

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 40 }, { wch: 10 }, { wch: 8 }, { wch: 24 }, { wch: 16 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Wycena')

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}
