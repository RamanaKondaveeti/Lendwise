export const reportTypes = [
  { id: 'expense', label: 'Expense report', description: 'Detailed expenses, participants, shares, and settlement status.' },
  { id: 'monthly', label: 'Monthly expense statement', description: 'Expense activity organized by month.' },
  { id: 'group', label: 'Group-wise expense report', description: 'Compare spending totals across your groups.' },
  { id: 'member', label: 'Member-wise contribution report', description: 'Compare amounts paid and expense shares by member.' },
  { id: 'settlement', label: 'Settlement history', description: 'Recorded payments between members.' },
  { id: 'outstanding', label: 'Outstanding balance report', description: 'Current balances by group and member.' },
]

const baseExpenseHeaders = [
  { key: 'date', label: 'Date' },
  { key: 'group', label: 'Group' },
  { key: 'description', label: 'Expense description' },
  { key: 'category', label: 'Category' },
  { key: 'paid_by', label: 'Paid by' },
  { key: 'participants', label: 'Participants and shares' },
  { key: 'total_amount', label: 'Total amount' },
  { key: 'personal_share', label: 'Personal share' },
  { key: 'currency', label: 'Currency' },
  { key: 'settlement_status', label: 'Settlement status' },
]

export function reportHeaders(type) {
  if (type === 'expense') return baseExpenseHeaders
  if (type === 'monthly') return [{ key: 'month', label: 'Month' }, ...baseExpenseHeaders]
  if (type === 'group') return baseExpenseHeaders
  if (type === 'member') {
    return [
      { key: 'date', label: 'Date' },
      { key: 'group', label: 'Group' },
      { key: 'member', label: 'Member' },
      { key: 'description', label: 'Expense description' },
      { key: 'category', label: 'Category' },
      { key: 'paid_by', label: 'Paid by' },
      { key: 'participants', label: 'Participants and shares' },
      { key: 'total_amount', label: 'Total amount' },
      { key: 'personal_share', label: 'Member share' },
      { key: 'paid_amount', label: 'Amount paid' },
      { key: 'currency', label: 'Currency' },
      { key: 'settlement_status', label: 'Settlement status' },
    ]
  }
  if (type === 'settlement') {
    return [
      { key: 'date', label: 'Date' },
      { key: 'group', label: 'Group' },
      { key: 'description', label: 'Description' },
      { key: 'paid_by', label: 'Paid by' },
      { key: 'payee', label: 'Paid to' },
      { key: 'participants', label: 'Participants' },
      { key: 'total_amount', label: 'Amount' },
      { key: 'personal_share', label: 'Personal share' },
      { key: 'currency', label: 'Currency' },
      { key: 'settlement_status', label: 'Status' },
    ]
  }
  return [
    { key: 'date', label: 'As of' },
    { key: 'group', label: 'Group' },
    { key: 'description', label: 'Member' },
    { key: 'participants', label: 'Member' },
    { key: 'settlement_status', label: 'Status' },
    { key: 'balance', label: 'Outstanding balance' },
    { key: 'currency', label: 'Currency' },
  ]
}

export function presentReportRow(row) {
  return {
    ...row,
    group: row.group_name || '',
    member: row.participant || row.description || '',
  }
}

const xmlEscape = value => String(value ?? '')
  .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const csvEscape = value => {
  const raw = String(value ?? '')
  const text = typeof value === 'string' && /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function reportCsv(headers, rows) {
  return [headers.map(header => header.label), ...rows.map(row => headers.map(header => row[header.key]))]
    .map(values => values.map(csvEscape).join(','))
    .join('\r\n')
}

function columnName(index) {
  let name = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name
  }
  return name
}

function worksheetXml(headers, rows) {
  const allRows = [headers, ...rows.map(row => headers.map(header => row[header.key]))]
  const sheetRows = allRows.map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
}

export async function reportXlsx(headers, rows, title = 'GroupBuk Report') {
  const { zipSync } = await import('fflate')
  const safeTitle = String(title).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Report'
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(safeTitle)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': worksheetXml(headers, rows),
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, new TextEncoder().encode(value)])))
}

export async function reportPdf(headers, rows, title = 'GroupBuk Report') {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 30
  const rowHeight = 17
  const widths = headers.map(() => (pageWidth - margin * 2) / headers.length)
  let y = 55
  let page = 1
  const drawHeader = () => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.setTextColor(33, 72, 53)
    pdf.text(title, margin, 28)
    pdf.setFontSize(7)
    pdf.setFillColor(232, 244, 235)
    pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, 'F')
    headers.forEach((header, index) => {
      pdf.text(String(header.label).slice(0, 24), margin + widths.slice(0, index).reduce((sum, width) => sum + width, 0) + 4, y + 11)
    })
    y += rowHeight
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(47, 62, 51)
  }
  drawHeader()
  for (const row of rows) {
    if (y + rowHeight > pageHeight - margin) {
      pdf.setFontSize(7)
      pdf.text(`Page ${page}`, pageWidth - margin - 35, pageHeight - 14)
      pdf.addPage()
      page += 1
      y = 38
      drawHeader()
    }
    headers.forEach((header, index) => {
      const startX = margin + widths.slice(0, index).reduce((sum, width) => sum + width, 0) + 4
      const text = String(row[header.key] ?? '').replace(/\s+/g, ' ')
      pdf.text(text.slice(0, Math.max(8, Math.floor(widths[index] / 4))), startX, y + 11)
    })
    pdf.setDrawColor(232, 238, 233)
    pdf.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight)
    y += rowHeight
  }
  pdf.setFontSize(7)
  pdf.text(`Page ${page}`, pageWidth - margin - 35, pageHeight - 14)
  return pdf.output('arraybuffer')
}

export function convertReportRow(row, rate, currency) {
  const converted = { ...row }
  for (const key of ['total_amount', 'personal_share', 'paid_amount', 'share_amount', 'outstanding_amount', 'balance']) {
    if (converted[key] !== undefined && converted[key] !== null) {
      converted[key] = Math.round(Number(converted[key]) * rate * 100) / 100
    }
  }
  converted.currency = currency
  return converted
}

export function summarizeReportRows(rows) {
  const totals = rows.reduce((summary, row) => {
    const totalAmount = Number(row.total_amount || 0)
    const personalShare = Number(row.personal_share || 0)
    summary.totalAmountCents += Number.isFinite(totalAmount) ? Math.round(totalAmount * 100) : 0
    summary.personalShareCents += Number.isFinite(personalShare) ? Math.round(personalShare * 100) : 0
    return summary
  }, { totalAmountCents: 0, personalShareCents: 0 })

  return {
    totalAmount: totals.totalAmountCents / 100,
    personalShare: totals.personalShareCents / 100,
  }
}
