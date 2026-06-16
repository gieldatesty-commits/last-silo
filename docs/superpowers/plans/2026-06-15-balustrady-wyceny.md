# BaluSTRADY — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app for pricing stainless steel railings — quote editor, PDF export, Excel export, price list management, and magic-link auth.

**Architecture:** Next.js 15 App Router full-stack app. Server Actions handle all mutations. Prisma + PostgreSQL (Neon) for persistence. Auth.js v5 with Resend magic links. PDF generated server-side via `@react-pdf/renderer`. All pages are protected by middleware.

**Tech Stack:** Next.js 15, Prisma, PostgreSQL (Neon), Auth.js v5, Resend, @react-pdf/renderer, xlsx, Tailwind CSS, shadcn/ui, Vitest

---

## File Map

```
src/
  app/
    (auth)/
      login/page.tsx               # Magic link login page
      login/action.ts              # Server action: send magic link
    (app)/
      layout.tsx                   # App shell with nav
      quotes/
        page.tsx                   # Quote list
        actions.ts                 # Server actions: create, delete, duplicate quote
        new/page.tsx               # Redirect → creates draft + redirects to /quotes/[id]
        [id]/
          page.tsx                 # Quote editor (two-column)
          actions.ts               # Server actions: save quote, update status
      price-list/
        page.tsx                   # Price list table
        actions.ts                 # Server actions: create, update, delete price list item
      settings/
        page.tsx                   # Company settings form
        actions.ts                 # Server action: save settings
  api/
    quotes/[id]/pdf/route.ts       # GET → stream PDF response
    quotes/[id]/excel/route.ts     # GET → stream Excel response
    auth/[...nextauth]/route.ts    # Auth.js handler
  lib/
    prisma.ts                      # Prisma client singleton
    auth.ts                        # Auth.js config
    calc.ts                        # Price calculation helpers (testable)
    quote-number.ts                # Quote number generation (testable)
    pdf.tsx                        # React-PDF document component
    excel.ts                       # Excel workbook builder
  middleware.ts                    # Protect all (app) routes
prisma/
  schema.prisma
  seed.ts                          # Seed price list with sample items
```

---

## Task 1: Scaffold project + install dependencies

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json` (via CLI)
- Create: `.env.local.example`

- [ ] **Step 1: Scaffold Next.js app**

```bash
cd C:\Users\damia\baLUSTRADY
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --no-git --yes
```

Expected: project files created, `npm run dev` works.

- [ ] **Step 2: Install dependencies**

```bash
npm install prisma @prisma/client
npm install next-auth@beta @auth/prisma-adapter
npm install resend
npm install @react-pdf/renderer
npm install xlsx
npm install @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-label
npm install lucide-react
npm install clsx tailwind-merge
npx shadcn@latest init --defaults
npx shadcn@latest add button input label table dialog select badge card
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D vitest @vitejs/plugin-react vitest-environment-node
```

- [ ] **Step 4: Configure Vitest**

Add to `package.json` scripts:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 5: Create `.env.local.example`**

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
AUTH_SECRET="run: npx auth secret"
AUTH_RESEND_KEY="re_..."
NEXTAUTH_URL="http://localhost:3000"
```

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold Next.js project with dependencies"
```

---

## Task 2: Prisma schema + database setup

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Create: `src/lib/prisma.ts`

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write schema**

Replace `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  quotes        Quote[]
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

model Quote {
  id          String      @id @default(cuid())
  number      String      @unique
  clientName  String
  clientAddr  String      @default("")
  clientPhone String      @default("")
  clientEmail String      @default("")
  markupPct   Decimal     @default(20)
  status      QuoteStatus @default(DRAFT)
  createdBy   String
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  user        User        @relation(fields: [createdBy], references: [id])
  items       QuoteItem[]
}

enum QuoteStatus {
  DRAFT
  SENT
  ACCEPTED
}

model QuoteItem {
  id        String  @id @default(cuid())
  quoteId   String
  name      String
  quantity  Decimal
  unit      String
  unitPrice Decimal
  sortOrder Int     @default(0)
  quote     Quote   @relation(fields: [quoteId], references: [id], onDelete: Cascade)
}

model PriceListItem {
  id        String  @id @default(cuid())
  name      String
  unit      String
  basePrice Decimal
  category  String  @default("")
  active    Boolean @default(true)
}

model CompanySettings {
  id                String  @id @default(cuid())
  name              String  @default("")
  nip               String  @default("")
  address           String  @default("")
  phone             String  @default("")
  email             String  @default("")
  logoUrl           String?
  quoteValidityDays Int     @default(30)
  defaultMarkupPct  Decimal @default(20)
}
```

- [ ] **Step 3: Create Prisma client singleton**

Create `src/lib/prisma.ts`:
```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 4: Create seed file**

Create `prisma/seed.ts`:
```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.priceListItem.createMany({
    skipDuplicates: true,
    data: [
      { name: 'Pochwyt Ø42 mm', unit: 'mb', basePrice: 85, category: 'pochwyt' },
      { name: 'Pochwyt Ø48 mm', unit: 'mb', basePrice: 95, category: 'pochwyt' },
      { name: 'Słupek H=1000 mm', unit: 'szt', basePrice: 120, category: 'słupek' },
      { name: 'Słupek H=1100 mm', unit: 'szt', basePrice: 135, category: 'słupek' },
      { name: 'Pręt pionowy Ø12', unit: 'szt', basePrice: 35, category: 'wypełnienie' },
      { name: 'Szkło VSG 10 mm', unit: 'm2', basePrice: 280, category: 'wypełnienie' },
      { name: 'Lina Ø4 mm', unit: 'mb', basePrice: 18, category: 'wypełnienie' },
      { name: 'Montaż na budowie', unit: 'kpl', basePrice: 800, category: 'montaż' },
    ],
  })

  await prisma.companySettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      name: 'Twoja Firma',
      defaultMarkupPct: 20,
      quoteValidityDays: 30,
    },
  })

  console.log('Seed complete')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

Add to `package.json`:
```json
{
  "prisma": {
    "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
  }
}
```

- [ ] **Step 5: Set DATABASE_URL in `.env.local` and run migration**

```bash
npx prisma migrate dev --name init
npx prisma db seed
```

Expected: tables created, seed data inserted.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add Prisma schema and seed data"
```

---

## Task 3: Auth.js magic-link setup

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/middleware.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/login/action.ts`

- [ ] **Step 1: Generate AUTH_SECRET**

```bash
npx auth secret
```

Copy output to `.env.local` as `AUTH_SECRET=...`

Also add to `.env.local`:
```env
AUTH_RESEND_KEY=re_your_key_here
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 2: Create auth config**

Create `src/lib/auth.ts`:
```ts
import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Resend from 'next-auth/providers/resend'
import { prisma } from '@/lib/prisma'

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: 'no-reply@yourdomain.com',
    }),
  ],
  pages: {
    signIn: '/login',
  },
})
```

- [ ] **Step 3: Create API route**

Create `src/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 4: Create middleware to protect app routes**

Create `src/middleware.ts`:
```ts
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isLoginPage = req.nextUrl.pathname.startsWith('/login')

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL('/quotes', req.url))
  }
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 5: Create login page**

Create `src/app/(auth)/login/page.tsx`:
```tsx
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
```

- [ ] **Step 6: Start dev server and verify login page loads**

```bash
npm run dev
```

Open http://localhost:3000 — should redirect to http://localhost:3000/login. Login page should render.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add Auth.js magic-link login with middleware"
```

---

## Task 4: Price calculation helpers (TDD)

**Files:**
- Create: `src/lib/calc.ts`
- Create: `src/lib/calc.test.ts`
- Create: `src/lib/quote-number.ts`
- Create: `src/lib/quote-number.test.ts`

- [ ] **Step 1: Write failing tests for calc.ts**

Create `src/lib/calc.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module './calc'`

- [ ] **Step 3: Implement calc.ts**

Create `src/lib/calc.ts`:
```ts
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
```

- [ ] **Step 4: Write failing tests for quote-number.ts**

Create `src/lib/quote-number.test.ts`:
```ts
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
```

- [ ] **Step 5: Implement quote-number.ts**

Create `src/lib/quote-number.ts`:
```ts
export function buildQuoteNumber(date: Date, sequenceInMonth: number): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const seq = String(sequenceInMonth).padStart(3, '0')
  return `${year}/${month}/${seq}`
}
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
npm test
```

Expected: all 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add price calculation and quote number helpers with tests"
```

---

## Task 5: App shell (layout + navigation)

**Files:**
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/page.tsx` (redirect)

- [ ] **Step 1: Create app layout with nav**

Create `src/app/(app)/layout.tsx`:
```tsx
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
```

- [ ] **Step 2: Create root redirect**

Create `src/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
export default function Home() {
  redirect('/quotes')
}
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add app shell layout with navigation"
```

---

## Task 6: Company settings page

**Files:**
- Create: `src/app/(app)/settings/page.tsx`
- Create: `src/app/(app)/settings/actions.ts`

- [ ] **Step 1: Create server actions**

Create `src/app/(app)/settings/actions.ts`:
```ts
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export async function saveSettings(formData: FormData) {
  await prisma.companySettings.upsert({
    where: { id: 'singleton' },
    update: {
      name: formData.get('name') as string,
      nip: formData.get('nip') as string,
      address: formData.get('address') as string,
      phone: formData.get('phone') as string,
      email: formData.get('email') as string,
      quoteValidityDays: Number(formData.get('quoteValidityDays')),
      defaultMarkupPct: Number(formData.get('defaultMarkupPct')),
    },
    create: {
      id: 'singleton',
      name: formData.get('name') as string,
      nip: formData.get('nip') as string,
      address: formData.get('address') as string,
      phone: formData.get('phone') as string,
      email: formData.get('email') as string,
      quoteValidityDays: Number(formData.get('quoteValidityDays')),
      defaultMarkupPct: Number(formData.get('defaultMarkupPct')),
    },
  })
  revalidatePath('/settings')
}
```

- [ ] **Step 2: Create settings page**

Create `src/app/(app)/settings/page.tsx`:
```tsx
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
```

- [ ] **Step 3: Verify in browser**

Navigate to http://localhost:3000/settings. Fill in and save — reload to confirm persistence.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add company settings page"
```

---

## Task 7: Price list CRUD

**Files:**
- Create: `src/app/(app)/price-list/page.tsx`
- Create: `src/app/(app)/price-list/actions.ts`

- [ ] **Step 1: Create server actions**

Create `src/app/(app)/price-list/actions.ts`:
```ts
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export async function createPriceListItem(formData: FormData) {
  await prisma.priceListItem.create({
    data: {
      name: formData.get('name') as string,
      unit: formData.get('unit') as string,
      basePrice: Number(formData.get('basePrice')),
      category: (formData.get('category') as string) ?? '',
    },
  })
  revalidatePath('/price-list')
}

export async function updatePriceListItem(id: string, formData: FormData) {
  await prisma.priceListItem.update({
    where: { id },
    data: {
      name: formData.get('name') as string,
      unit: formData.get('unit') as string,
      basePrice: Number(formData.get('basePrice')),
      category: (formData.get('category') as string) ?? '',
    },
  })
  revalidatePath('/price-list')
}

export async function deletePriceListItem(id: string) {
  await prisma.priceListItem.delete({ where: { id } })
  revalidatePath('/price-list')
}
```

- [ ] **Step 2: Create price list page**

Create `src/app/(app)/price-list/page.tsx`:
```tsx
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
                    onClick={(e) => {
                      if (!confirm('Usunąć element?')) e.preventDefault()
                    }}
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
```

- [ ] **Step 3: Verify in browser**

Navigate to http://localhost:3000/price-list. Seed items should be listed. Add a new item, delete one — verify changes persist.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add price list CRUD page"
```

---

## Task 8: Quote list page

**Files:**
- Create: `src/app/(app)/quotes/page.tsx`
- Create: `src/app/(app)/quotes/actions.ts`

- [ ] **Step 1: Create quote server actions**

Create `src/app/(app)/quotes/actions.ts`:
```ts
'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { buildQuoteNumber } from '@/lib/quote-number'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

async function getNextSequence(): Promise<number> {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  const count = await prisma.quote.count({
    where: { createdAt: { gte: startOfMonth, lte: endOfMonth } },
  })
  return count + 1
}

export async function createQuote() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const settings = await prisma.companySettings.findFirst()
  const seq = await getNextSequence()
  const number = buildQuoteNumber(new Date(), seq)

  const quote = await prisma.quote.create({
    data: {
      number,
      clientName: '',
      markupPct: settings?.defaultMarkupPct ?? 20,
      createdBy: session.user.id,
    },
  })

  redirect(`/quotes/${quote.id}`)
}

export async function deleteQuote(id: string) {
  await prisma.quote.delete({ where: { id } })
  revalidatePath('/quotes')
}

export async function duplicateQuote(id: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const original = await prisma.quote.findUniqueOrThrow({
    where: { id },
    include: { items: true },
  })

  const seq = await getNextSequence()
  const number = buildQuoteNumber(new Date(), seq)

  const copy = await prisma.quote.create({
    data: {
      number,
      clientName: original.clientName,
      clientAddr: original.clientAddr,
      clientPhone: original.clientPhone,
      clientEmail: original.clientEmail,
      markupPct: original.markupPct,
      createdBy: session.user.id,
      items: {
        create: original.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          sortOrder: item.sortOrder,
        })),
      },
    },
  })

  redirect(`/quotes/${copy.id}`)
}
```

- [ ] **Step 2: Create quote list page**

Create `src/app/(app)/quotes/page.tsx`:
```tsx
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
```

- [ ] **Step 3: Verify in browser**

Navigate to http://localhost:3000/quotes. Click „Nowa wycena" — should redirect to `/quotes/[id]` (404 for now, that's fine).

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add quote list page with create/delete/duplicate actions"
```

---

## Task 9: Quote editor page

**Files:**
- Create: `src/app/(app)/quotes/[id]/page.tsx`
- Create: `src/app/(app)/quotes/[id]/actions.ts`

- [ ] **Step 1: Create quote editor server actions**

Create `src/app/(app)/quotes/[id]/actions.ts`:
```ts
'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { QuoteStatus } from '@prisma/client'

export async function saveQuote(id: string, formData: FormData) {
  const itemsJson = formData.get('items') as string
  const items: { name: string; quantity: number; unit: string; unitPrice: number }[] =
    JSON.parse(itemsJson)

  await prisma.quote.update({
    where: { id },
    data: {
      clientName: formData.get('clientName') as string,
      clientAddr: (formData.get('clientAddr') as string) ?? '',
      clientPhone: (formData.get('clientPhone') as string) ?? '',
      clientEmail: (formData.get('clientEmail') as string) ?? '',
      markupPct: Number(formData.get('markupPct')),
      items: {
        deleteMany: {},
        create: items.map((item, idx) => ({
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          sortOrder: idx,
        })),
      },
    },
  })
  revalidatePath(`/quotes/${id}`)
}

export async function updateQuoteStatus(id: string, status: QuoteStatus) {
  await prisma.quote.update({ where: { id }, data: { status } })
  revalidatePath(`/quotes/${id}`)
  revalidatePath('/quotes')
}
```

- [ ] **Step 2: Create quote editor page**

Create `src/app/(app)/quotes/[id]/page.tsx`:
```tsx
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { saveQuote, updateQuoteStatus } from './actions'
import { QuoteEditorClient } from './QuoteEditorClient'

export default async function QuoteEditorPage({ params }: { params: { id: string } }) {
  const [quote, priceList, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: params.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.priceListItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.companySettings.findFirst(),
  ])

  if (!quote) notFound()

  const saveAction = saveQuote.bind(null, params.id)

  return (
    <QuoteEditorClient
      quote={quote}
      priceList={priceList}
      settings={settings}
      saveAction={saveAction}
      updateStatusAction={updateQuoteStatus.bind(null, params.id)}
    />
  )
}
```

- [ ] **Step 3: Create QuoteEditorClient component**

Create `src/app/(app)/quotes/[id]/QuoteEditorClient.tsx`:
```tsx
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
    const formData = new FormData()
    const form = document.getElementById('quote-form') as HTMLFormElement
    const fd = new FormData(form)
    fd.set('items', JSON.stringify(items))
    fd.set('markupPct', String(markupPct))
    startTransition(() => saveAction(fd))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Wycena {quote.number}</h1>
        </div>
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
                    defaultValue={f.defaultValue}
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
```

- [ ] **Step 4: Verify in browser**

Navigate to http://localhost:3000/quotes → click Nowa wycena → editor should render. Add items from cennik, edit quantities, watch summary update live. Click Zapisz.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add two-column quote editor with live price summary"
```

---

## Task 10: PDF generation

**Files:**
- Create: `src/lib/pdf.tsx`
- Create: `src/app/api/quotes/[id]/pdf/route.ts`

- [ ] **Step 1: Create PDF document component**

Create `src/lib/pdf.tsx`:
```tsx
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import { calcQuoteTotals } from './calc'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  companyName: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  companyMeta: { fontSize: 8, color: '#64748b', marginTop: 2 },
  offerTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  metaBlock: { fontSize: 9 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    color: '#ffffff',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  tableRowAlt: { backgroundColor: '#f8fafc' },
  tableSummary: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    color: '#ffffff',
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontFamily: 'Helvetica-Bold',
  },
  colName: { flex: 3 },
  colQty: { flex: 1, textAlign: 'right' },
  colUnit: { flex: 1, textAlign: 'left', paddingLeft: 4 },
  colPrice: { flex: 1.5, textAlign: 'right' },
  colTotal: { flex: 1.5, textAlign: 'right' },
  footer: { marginTop: 16, fontSize: 8, color: '#94a3b8' },
})

type Props = {
  quote: {
    number: string
    clientName: string
    clientAddr: string
    clientEmail: string
    clientPhone: string
    createdAt: Date
    items: { name: string; quantity: number; unit: string; unitPrice: number }[]
  }
  company: {
    name: string
    nip: string
    address: string
    phone: string
    email: string
    quoteValidityDays: number
  }
}

export function QuotePdfDocument({ quote, company }: Props) {
  const totals = calcQuoteTotals(quote.items)
  const validUntil = new Date(quote.createdAt)
  validUntil.setDate(validUntil.getDate() + company.quoteValidityDays)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{company.name}</Text>
            <Text style={styles.companyMeta}>{company.address}</Text>
            <Text style={styles.companyMeta}>NIP: {company.nip}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.offerTitle}>OFERTA NR {quote.number}</Text>
            <Text style={styles.companyMeta}>
              Data: {quote.createdAt.toLocaleDateString('pl-PL')}
            </Text>
          </View>
        </View>

        <View style={styles.meta}>
          <View style={styles.metaBlock}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Klient:</Text>
            <Text>{quote.clientName}</Text>
            {quote.clientAddr ? <Text>{quote.clientAddr}</Text> : null}
            {quote.clientPhone ? <Text>{quote.clientPhone}</Text> : null}
            {quote.clientEmail ? <Text>{quote.clientEmail}</Text> : null}
          </View>
          <View style={styles.metaBlock}>
            <Text>Ważna do: {validUntil.toLocaleDateString('pl-PL')}</Text>
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colName}>Pozycja</Text>
          <Text style={styles.colQty}>Ilość</Text>
          <Text style={styles.colUnit}>J.m.</Text>
          <Text style={styles.colPrice}>Cena jedn.</Text>
          <Text style={styles.colTotal}>Wartość</Text>
        </View>

        {quote.items.map((item, idx) => (
          <View
            key={idx}
            style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
          >
            <Text style={styles.colName}>{item.name}</Text>
            <Text style={styles.colQty}>{item.quantity}</Text>
            <Text style={styles.colUnit}>{item.unit}</Text>
            <Text style={styles.colPrice}>{item.unitPrice.toFixed(2)} zł</Text>
            <Text style={styles.colTotal}>
              {(item.quantity * item.unitPrice).toFixed(2)} zł
            </Text>
          </View>
        ))}

        <View style={{ marginTop: 8 }}>
          {[
            { label: 'Razem netto', value: `${totals.netTotal.toFixed(2)} zł` },
            { label: 'VAT 23%', value: `${totals.vat.toFixed(2)} zł` },
          ].map((row) => (
            <View
              key={row.label}
              style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 2 }}
            >
              <Text style={{ marginRight: 16, color: '#64748b' }}>{row.label}</Text>
              <Text style={{ fontFamily: 'Helvetica-Bold', width: 80, textAlign: 'right' }}>
                {row.value}
              </Text>
            </View>
          ))}
          <View style={styles.tableSummary}>
            <Text style={{ flex: 1 }}>RAZEM BRUTTO</Text>
            <Text style={{ width: 80, textAlign: 'right' }}>
              {totals.grossTotal.toFixed(2)} zł
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>
            Oferta ważna {company.quoteValidityDays} dni. Ceny zawierają VAT 23%.
          </Text>
          <Text>
            {company.phone} | {company.email}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Create PDF API route**

Create `src/app/api/quotes/[id]/pdf/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { QuotePdfDocument } from '@/lib/pdf'
import { auth } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [quote, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: params.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.companySettings.findFirst(),
  ])

  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const company = {
    name: settings?.name ?? '',
    nip: settings?.nip ?? '',
    address: settings?.address ?? '',
    phone: settings?.phone ?? '',
    email: settings?.email ?? '',
    quoteValidityDays: settings?.quoteValidityDays ?? 30,
  }

  const quoteData = {
    number: quote.number,
    clientName: quote.clientName,
    clientAddr: quote.clientAddr,
    clientEmail: quote.clientEmail,
    clientPhone: quote.clientPhone,
    createdAt: quote.createdAt,
    items: quote.items.map((i) => ({
      name: i.name,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.unitPrice),
    })),
  }

  const buffer = await renderToBuffer(<QuotePdfDocument quote={quoteData} company={company} />)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="oferta-${quote.number.replace(/\//g, '-')}.pdf"`,
    },
  })
}
```

- [ ] **Step 3: Verify in browser**

Open a quote, click „PDF" — browser should download a PDF file. Open it and verify content is correct.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add PDF generation for quotes"
```

---

## Task 11: Excel export

**Files:**
- Create: `src/lib/excel.ts`
- Create: `src/app/api/quotes/[id]/excel/route.ts`

- [ ] **Step 1: Create Excel builder**

Create `src/lib/excel.ts`:
```ts
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
```

- [ ] **Step 2: Create Excel API route**

Create `src/app/api/quotes/[id]/excel/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildQuoteExcel } from '@/lib/excel'
import { auth } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  })

  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const buffer = buildQuoteExcel({
    number: quote.number,
    clientName: quote.clientName,
    clientAddr: quote.clientAddr,
    items: quote.items.map((i) => ({
      name: i.name,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPrice: Number(i.unitPrice),
    })),
  })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wycena-${quote.number.replace(/\//g, '-')}.xlsx"`,
    },
  })
}
```

- [ ] **Step 3: Verify in browser**

Open a quote with items, click „Excel" — should download `.xlsx`. Open in Excel/LibreOffice and verify rows, totals.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add Excel export for quotes"
```

---

## Task 12: Deploy to Vercel

**Files:**
- Create: `.gitignore` (if not present)
- No new source files

- [ ] **Step 1: Ensure .gitignore is correct**

Verify `.gitignore` contains:
```
.env.local
.next/
node_modules/
.superpowers/
```

- [ ] **Step 2: Install Vercel CLI (if not installed)**

```bash
npm i -g vercel
```

- [ ] **Step 3: Link project to Vercel**

```bash
vercel link
```

- [ ] **Step 4: Add environment variables to Vercel**

```bash
vercel env add DATABASE_URL
vercel env add AUTH_SECRET
vercel env add AUTH_RESEND_KEY
vercel env add NEXTAUTH_URL
```

Set `NEXTAUTH_URL` to your Vercel production URL (e.g. `https://balustrady.vercel.app`).

- [ ] **Step 5: Deploy**

```bash
vercel --prod
```

- [ ] **Step 6: Run migration on production database**

```bash
DATABASE_URL="your_neon_prod_url" npx prisma migrate deploy
DATABASE_URL="your_neon_prod_url" npx prisma db seed
```

- [ ] **Step 7: Verify production**

Open the Vercel URL. Log in with magic link. Create a quote. Generate PDF. ✓

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "chore: finalize deployment config"
```
