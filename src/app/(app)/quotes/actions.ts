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
