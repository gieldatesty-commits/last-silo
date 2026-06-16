import { prisma } from '@/lib/prisma'
import { saveSettings } from './actions'

export default async function SettingsPage() {
  const s = await prisma.companySettings.findFirst() ?? {
    name: '', nip: '', address: '', phone: '', email: '',
    quoteValidityDays: 30, defaultMarkupPct: 20,
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-6">Ustawienia firmy</h1>
      <form action={saveSettings} className="space-y-4">
        {[
          { name: 'name', label: 'Nazwa firmy', value: s.name },
          { name: 'nip', label: 'NIP', value: s.nip },
          { name: 'address', label: 'Adres', value: s.address },
          { name: 'phone', label: 'Telefon', value: s.phone },
          { name: 'email', label: 'Email kontaktowy', value: s.email },
        ].map((f) => (
          <div key={f.name}>
            <label className="block text-sm font-medium mb-1">{f.label}</label>
            <input
              name={f.name}
              defaultValue={f.value}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
        ))}
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Ważność oferty (dni)</label>
            <input
              name="quoteValidityDays"
              type="number"
              defaultValue={s.quoteValidityDays}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Domyślny narzut (%)</label>
            <input
              name="defaultMarkupPct"
              type="number"
              defaultValue={Number(s.defaultMarkupPct)}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          className="bg-slate-900 text-white px-6 py-2 rounded text-sm font-medium hover:bg-slate-800"
        >
          Zapisz
        </button>
      </form>
    </div>
  )
}
