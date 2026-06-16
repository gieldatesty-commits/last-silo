import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
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
