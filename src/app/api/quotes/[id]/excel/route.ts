import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildQuoteExcel } from '@/lib/excel'
import { auth } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const quote = await prisma.quote.findUnique({
    where: { id },
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

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wycena-${quote.number.replace(/\//g, '-')}.xlsx"`,
    },
  })
}
