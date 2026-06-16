import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { QuotePdfDocument } from '@/lib/pdf'
import { auth } from '@/lib/auth'
import React, { type ReactElement } from 'react'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [quote, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id },
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

  const buffer = await renderToBuffer(
    React.createElement(QuotePdfDocument, { quote: quoteData, company }) as ReactElement<DocumentProps>
  )

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="oferta-${quote.number.replace(/\//g, '-')}.pdf"`,
    },
  })
}
