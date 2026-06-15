export function buildQuoteNumber(date: Date, sequenceInMonth: number): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const seq = String(sequenceInMonth).padStart(3, '0')
  return `${year}/${month}/${seq}`
}
