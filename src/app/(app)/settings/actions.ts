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
