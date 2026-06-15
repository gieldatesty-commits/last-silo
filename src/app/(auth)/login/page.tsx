import { signIn } from '@/lib/auth'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">BaluSTRADY</h1>
        <p className="text-gray-500 text-sm text-center mb-6">
          Wpisz swój adres email — wyślemy Ci link do logowania.
        </p>
        <form
          action={async (formData: FormData) => {
            'use server'
            await signIn('resend', {
              email: formData.get('email') as string,
              redirectTo: '/quotes',
            })
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="jan@firma.pl"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-slate-900 text-white py-2 rounded text-sm font-medium hover:bg-slate-800"
          >
            Wyślij link do logowania
          </button>
        </form>
      </div>
    </div>
  )
}
