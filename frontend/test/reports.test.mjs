import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import {
  convertReportRow,
  reportCsv,
  reportHeaders,
  reportPdf,
  reportXlsx,
} from '../src/reports.mjs'

const headers = reportHeaders('expense')
const rows = [{
  date: '2025-01-03',
  group: 'Weekend group',
  description: 'Dinner, with friends',
  category: 'Food & Dining',
  paid_by: 'Asha',
  participants: 'Asha (10.00), Ben (10.00)',
  total_amount: 20,
  personal_share: 10,
  currency: 'INR',
  settlement_status: 'Unpaid',
}]

test('CSV export preserves descriptions, escapes separators, and includes actual split values', () => {
  const csv = reportCsv(headers, rows)
  assert.match(csv, /Expense description/)
  assert.match(csv, /"Dinner, with friends"/)
  assert.match(csv, /Asha \(10\.00\), Ben \(10\.00\)/)
  assert.match(csv, /Unpaid/)
  assert.match(reportCsv(headers, [{ ...rows[0], description: '=1+1' }]), /'=1\+1/)
});

test('Excel export is a valid OpenXML ZIP workbook with report columns and rows', async () => {
  const workbook = await reportXlsx(headers, [{ ...rows[0], description: 'Dinner\u0001 with friends' }], 'Expense / Report')
  const archive = unzipSync(workbook)
  const sheet = strFromU8(archive['xl/worksheets/sheet1.xml'])
  const workbookXml = strFromU8(archive['xl/workbook.xml'])
  assert.ok(archive['[Content_Types].xml'])
  assert.match(workbookXml, /Expense Report/)
  assert.match(sheet, /Dinner with friends/)
  assert.match(sheet, /Food &amp; Dining/)
  assert.match(sheet, /20/)
});

test('PDF export returns a multipage-capable PDF document', async () => {
  const pdf = await reportPdf(headers, rows, 'Expense report')
  const content = new TextDecoder().decode(pdf)
  assert.match(content, /^%PDF-/)
  assert.ok(pdf.byteLength > 500)
});

test('currency presentation converts report values without changing source records', () => {
  const source = { total_amount: 100, personal_share: 33.33, currency: 'INR' }
  const usd = convertReportRow(source, 0.012, 'USD')
  assert.equal(usd.total_amount, 1.2)
  assert.equal(usd.personal_share, 0.4)
  assert.equal(usd.currency, 'USD')
  assert.deepEqual(source, { total_amount: 100, personal_share: 33.33, currency: 'INR' })
});
