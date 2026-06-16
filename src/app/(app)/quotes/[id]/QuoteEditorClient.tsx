'use client'

import { useState, useTransition } from 'react'
import { calcQuoteTotals, applyMarkup } from '@/lib/calc'
import type { Quote, QuoteItem, PriceListItem, CompanySettings, QuoteStatus } from '@prisma/client'

type Props = {
  quote: Quote & { items: QuoteItem[] }
  priceList: PriceListItem[]
  settings: CompanySettings | null
  saveAction: (formData: FormData) => Promise<void>
  updateStatusAction: (status: QuoteStatus) => Promise<void>
}

type Item = { name: string; quantity: number; unit: string; unitPrice: number }

const STATUS_OPTIONS: { value: QuoteStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Szkic' },
  { value: 'SENT', label: 'Wysłana' },
  { value: 'ACCEPTED', label: 'Zaakceptowana' },
]

export function QuoteEditorClient({ quote, priceList, settings, saveAction, updateStatusAction }: Props) {
  const [items, setItems] = useState<Item[]>(
    quote.items.map((i) => ({
      name: i.name,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.unitPrice),
    }))
  )
  const [markupPct, setMarkupPct] = useState(Number(quote.markupPct))
  const [isPending, startTransition] = useTransition()
  const [showAddItem, setShowAddItem] = useState(false)

  const totals = calcQuoteTotals(items)

  function addItemFromPriceList(pl: PriceListItem) {
    setItems((prev) => [
      ...prev,
      {
        name: pl.name,
        quantity: 1,
        unit: pl.unit,
        unitPrice: applyMarkup(Number(pl.basePrice), markupPct),
      },
    ])
    setShowAddItem(false)
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx: number, field: keyof Item, value: string | number) {
    setItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    )
  }

  function handleSave() {
    const form = document.getElementById('quote-form') as HTMLFormElement
    const fd = new FormData(form)
    fd.set('items', JSON.stringify(items))
    fd.set('markupPct', String(markupPct))
    startTransition(() => saveAction(fd))
  }

  // settings is available for future use (company name, VAT number, etc.)
  void settings

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Wycena {quote.number}</h1>
        <div className="flex gap-2">
          <select
            defaultValue={quote.status}
            onChange={(e) => startTransition(() => updateStatusAction(e.target.value as QuoteStatus))}
            className="border rounded px-2 py-1 text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="bg-slate-900 text-white px-4 py-1.5 rounded text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? 'Zapisuję...' : 'Zapisz'}
          </button>
          <a
            href={`/api/quotes/${quote.id}/pdf`}
            target="_blank"
            className="border border-slate-900 text-slate-900 px-4 py-1.5 rounded text-sm hover:bg-slate-50"
          >
            PDF
          </a>
          <a
            href={`/api/quotes/${quote.id}/excel`}
            className="border border-slate-900 text-slate-900 px-4 py-1.5 rounded text-sm hover:bg-slate-50"
          >
            Excel
          </a>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left column */}
        <div className="col-span-2 space-y-6">
          <form id="quote-form" className="bg-white border rounded p-4 space-y-3">
            <h2 className="font-semibold text-sm">Dane klienta</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: 'clientName', label: 'Nazwa klienta', defaultValue: quote.clientName },
                { name: 'clientAddr', label: 'Adres budowy', defaultValue: quote.clientAddr },
                { name: 'clientPhone', label: 'Telefon', defaultValue: quote.clientPhone },
                { name: 'clientEmail', label: 'Email', defaultValue: quote.clientEmail },
              ].map((f) => (
                <div key={f.name}>
                  <label className="block text-xs font-medium mb-1">{f.label}</label>
                  <input
                    name={f.name}
                    defaultValue={f.defaultValue ?? ''}
                    className="w-full border rounded px-2 py-1 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Narzut:</label>
              <input
                type="number"
                value={markupPct}
                onChange={(e) => setMarkupPct(Number(e.target.value))}
                className="border rounded px-2 py-1 text-sm w-20"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </form>

          <div className="bg-white border rounded p-4">
            <h2 className="font-semibold text-sm mb-3">Elementy wyceny</h2>
            <table className="w-full text-sm border-collapse mb-3">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left px-2 py-1">Nazwa</th>
                  <th className="text-right px-2 py-1 w-20">Ilość</th>
                  <th className="text-left px-2 py-1 w-16">J.m.</th>
                  <th className="text-right px-2 py-1 w-28">Cena jedn.</th>
                  <th className="text-right px-2 py-1 w-28">Wartość</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-2 py-1">
                      <input
                        value={item.name}
                        onChange={(e) => updateItem(idx, 'name', e.target.value)}
                        className="w-full border-0 outline-none text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                        className="w-full border-0 outline-none text-sm text-right"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={item.unit}
                        onChange={(e) => updateItem(idx, 'unit', e.target.value)}
                        className="w-full border-0 outline-none text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                        className="w-full border-0 outline-none text-sm text-right font-mono"
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-gray-600">
                      {(item.quantity * item.unitPrice).toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        onClick={() => removeItem(idx)}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex gap-2">
              <button
                onClick={() => setShowAddItem((v) => !v)}
                className="text-sm text-slate-700 border rounded px-3 py-1 hover:bg-gray-50"
              >
                + Dodaj element
              </button>
              <button
                onClick={() =>
                  setItems((prev) => [
                    ...prev,
                    { name: '', quantity: 1, unit: 'mb', unitPrice: 0 },
                  ])
                }
                className="text-sm text-slate-500 border rounded px-3 py-1 hover:bg-gray-50"
              >
                + Własny element
              </button>
            </div>

            {showAddItem && (
              <div className="mt-3 border rounded p-3 bg-gray-50">
                <p className="text-xs font-medium mb-2">Wybierz z cennika:</p>
                <div className="flex flex-wrap gap-2">
                  {priceList.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => addItemFromPriceList(pl)}
                      className="text-xs border rounded px-2 py-1 bg-white hover:bg-slate-50"
                    >
                      {pl.name} ({pl.unit})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column — live summary */}
        <div className="space-y-4">
          <div className="bg-white border rounded p-4 sticky top-4">
            <h2 className="font-semibold text-sm mb-4">Podsumowanie</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Netto</span>
                <span className="font-mono">{totals.netTotal.toFixed(2)} zł</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Narzut {markupPct}%</span>
                <span className="font-mono text-gray-400 text-xs">w cenach jedn.</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">VAT 23%</span>
                <span className="font-mono">{totals.vat.toFixed(2)} zł</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
                <span>Razem brutto</span>
                <span className="font-mono">{totals.grossTotal.toFixed(2)} zł</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
