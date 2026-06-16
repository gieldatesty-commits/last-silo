import Link from 'next/link'
import { auth, signOut } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-bold text-lg">BaluSTRADY</span>
          <Link href="/quotes" className="text-sm text-slate-300 hover:text-white">
            Wyceny
          </Link>
          <Link href="/price-list" className="text-sm text-slate-300 hover:text-white">
            Cennik
          </Link>
          <Link href="/settings" className="text-sm text-slate-300 hover:text-white">
            Ustawienia
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{session.user?.email}</span>
          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <button className="text-xs text-slate-400 hover:text-white">
              Wyloguj
            </button>
          </form>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
    </div>
  )
}
