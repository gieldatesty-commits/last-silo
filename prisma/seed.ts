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
