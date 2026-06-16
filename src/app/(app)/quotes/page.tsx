import { prisma } from '@/lib/prisma'
import { createQuote, deleteQuote, duplicateQuote } from './actions'
import { calcQuoteTotals } from '@/lib/calc'
import Link from 'next/link'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Szkic',
  SENT: 'Wysłana',
  ACCEPTED: 'Zaakceptowana',
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT: 'bg-blue-100 text-blue-700',
  ACCEPTED: 'bg-green-100 text-green-700',
}

export default async function QuotesPage() {
  const quotes = await prisma.quote.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Wyceny</h1>
        <form action={createQuote}>
          <button
            type="submit"
            className="bg-slate-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-slate-800"
          >
            + Nowa wycena
          </button>
        </form>
      </div>

      {quotes.length === 0 ? (
        <p className="text-gray-500 text-sm">Brak wycen. Utwórz pierwszą.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-900 text-white">
              <th className="text-left px-3 py-2">Numer</th>
              <th className="text-left px-3 py-2">Klient</th>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-right px-3 py-2">Wartość brutto</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q, i) => {
              const items = q.items.map((it) => ({
                quantity: Number(it.quantity),
                unitPrice: Number(it.unitPrice),
              }))
              const { grossTotal } = calcQuoteTotals(items)

              return (
                <tr key={q.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 font-mono">
                    <Link href={`/quotes/${q.id}`} className="hover:underline text-slate-700">
                      {q.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{q.clientName || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {q.createdAt.toLocaleDateString('pl-PL')}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {grossTotal > 0 ? `${grossTotal.toFixed(2)} zł` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[q.status]}`}>
                      {STATUS_LABELS[q.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-3 justify-end">
                      <form action={duplicateQuote.bind(null, q.id)}>
                        <button type="submit" className="text-xs text-blue-600 hover:underline">
                          Duplikuj
                        </button>
                      </form>
                      <form action={deleteQuote.bind(null, q.id)}>
                        <button
                          type="submit"
                          className="text-xs text-red-500 hover:underline"
                        >
                          Usuń
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
