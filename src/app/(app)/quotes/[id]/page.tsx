import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { saveQuote, updateQuoteStatus } from './actions'
import { QuoteEditorClient } from './QuoteEditorClient'

export default async function QuoteEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [quote, priceList, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.priceListItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.companySettings.findFirst(),
  ])

  if (!quote) notFound()

  const saveAction = saveQuote.bind(null, id)
  const updateStatusAction = updateQuoteStatus.bind(null, id)

  return (
    <QuoteEditorClient
      quote={quote}
      priceList={priceList}
      settings={settings}
      saveAction={saveAction}
      updateStatusAction={updateStatusAction}
    />
  )
}
