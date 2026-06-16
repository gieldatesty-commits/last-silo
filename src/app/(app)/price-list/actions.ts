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
