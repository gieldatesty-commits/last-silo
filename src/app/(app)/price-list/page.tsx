import { prisma } from '@/lib/prisma'
import { createPriceListItem, deletePriceListItem } from './actions'

export default async function PriceListPage() {
  const items = await prisma.priceListItem.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Cennik bazowy</h1>

      <table className="w-full text-sm border-collapse mb-8">
        <thead>
          <tr className="bg-slate-900 text-white">
            <th className="text-left px-3 py-2">Nazwa</th>
            <th className="text-left px-3 py-2">Kategoria</th>
            <th className="text-left px-3 py-2">Jednostka</th>
            <th className="text-right px-3 py-2">Cena bazowa netto</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-3 py-2">{item.name}</td>
              <td className="px-3 py-2 text-gray-500">{item.category}</td>
              <td className="px-3 py-2">{item.unit}</td>
              <td className="px-3 py-2 text-right font-mono">
                {Number(item.basePrice).toFixed(2)} zł
              </td>
              <td className="px-3 py-2 text-right">
                <form action={deletePriceListItem.bind(null, item.id)}>
                  <button
                    type="submit"
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Usuń
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bg-white border rounded p-4 max-w-lg">
        <h2 className="font-semibold mb-3 text-sm">Dodaj element</h2>
        <form action={createPriceListItem} className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1">Nazwa</label>
              <input name="name" required className="w-full border rounded px-2 py-1 text-sm" />
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium mb-1">Kategoria</label>
              <input name="category" className="w-full border rounded px-2 py-1 text-sm" placeholder="pochwyt" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-24">
              <label className="block text-xs font-medium mb-1">Jednostka</label>
              <input name="unit" required defaultValue="mb" className="w-full border rounded px-2 py-1 text-sm" />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium mb-1">Cena bazowa netto (zł)</label>
              <input name="basePrice" type="number" step="0.01" required className="w-full border rounded px-2 py-1 text-sm" />
            </div>
          </div>
          <button type="submit" className="bg-slate-900 text-white px-4 py-1.5 rounded text-sm">
            Dodaj
          </button>
        </form>
      </div>
    </div>
  )
}
