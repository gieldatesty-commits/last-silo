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
