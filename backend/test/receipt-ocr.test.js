const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  maxReceiptBytes, normalizeDate, normalizeTextractExpense, prepareReceiptForTextract,
  scanReceipt, validateReceiptFile,
} = require('../src/receipt-ocr');

test('validates image signatures, supported MIME types, and the upload size limit', () => {
  assert.equal(validateReceiptFile({ mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) }), true);
  assert.throws(() => validateReceiptFile({ mimetype: 'image/png', buffer: Buffer.from('not png') }), /does not match/);
  assert.throws(() => validateReceiptFile({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF') }), /JPEG, PNG, or WebP/);
  assert.throws(() => validateReceiptFile({ mimetype: 'image/png', buffer: Buffer.alloc(maxReceiptBytes + 1) }), /under 8 MB/);
});

test('normalizes Textract summary fields and item values while retaining confidence', () => {
  const result = normalizeTextractExpense({ ExpenseDocuments: [{
    SummaryFields: [
      { Type: { Text: 'VENDOR_NAME' }, ValueDetection: { Text: ' Cafe  North ', Confidence: 98 } },
      { Type: { Text: 'INVOICE_RECEIPT_DATE' }, ValueDetection: { Text: '01/31/2025', Confidence: 90 } },
      { Type: { Text: 'SUBTOTAL' }, ValueDetection: { Text: '₹1,000.00', Confidence: 88 } },
      { Type: { Text: 'TAX' }, ValueDetection: { Text: '180.00', Confidence: 80 } },
      { Type: { Text: 'TOTAL' }, ValueDetection: { Text: '1180.00', Confidence: 99 } },
      { Type: { Text: 'CURRENCY' }, ValueDetection: { Currency: { Code: 'INR' } } },
    ],
    LineItemGroups: [{ LineItems: [{ LineItemExpenseFields: [
      { Type: { Text: 'ITEM' }, ValueDetection: { Text: 'Coffee', Confidence: 95 } },
      { Type: { Text: 'QUANTITY' }, ValueDetection: { Text: '2' } },
      { Type: { Text: 'UNIT_PRICE' }, ValueDetection: { Text: '500.00' } },
      { Type: { Text: 'PRICE' }, ValueDetection: { Text: '1000.00' } },
    ] }] }],
  }] });
  assert.equal(result.merchant, 'Cafe North');
  assert.equal(result.receiptDate, '2025-01-31');
  assert.equal(result.subtotal, 1000);
  assert.equal(result.tax, 180);
  assert.equal(result.total, 1180);
  assert.equal(result.currency, 'INR');
  assert.deepEqual(result.items[0], { description: 'Coffee', quantity: 2, unitPrice: 500, totalPrice: 1000, confidence: 95 });
});

test('empty provider results remain safe and dates reject invalid calendar values', () => {
  assert.deepEqual(normalizeTextractExpense({}), {
    merchant: null, receiptDate: null, subtotal: null, tax: null, total: null,
    currency: null, items: [], confidence: { merchant: null, receiptDate: null, subtotal: null, tax: null, total: null },
  });
  assert.equal(normalizeDate('02/30/2025'), null);
});

test('converts WebP to PNG for Textract and calls the provider without filesystem storage', async () => {
  const webp = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#fff' } }).webp().toBuffer();
  const file = { mimetype: 'image/webp', buffer: webp };
  const converted = await prepareReceiptForTextract(file);
  assert.equal(converted.toString('ascii', 1, 4), 'PNG');
  let received;
  class Command { constructor(input) { this.input = input } }
  const output = await scanReceipt(converted, { send: async command => { received = command.input.Document.Bytes; return {}; } }, Command);
  assert.equal(received, converted);
  assert.equal(output.total, null);
});
