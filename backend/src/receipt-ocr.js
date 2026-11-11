const sharp = require('sharp');

const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxReceiptBytes = 8 * 1024 * 1024;

function validateReceiptFile(file) {
  if (!file || !supportedTypes.has(file.mimetype) || !Buffer.isBuffer(file.buffer) || !file.buffer.length || file.buffer.length > maxReceiptBytes) {
    throw new TypeError('Upload a JPEG, PNG, or WebP receipt under 8 MB.');
  }
  const bytes = file.buffer;
  const valid = file.mimetype === 'image/jpeg'
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : file.mimetype === 'image/png'
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new TypeError('The uploaded file does not match its image type.');
  return true;
}

function cleanText(value, maxLength = 255) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength) || null : null;
}

function numberFromText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).replace(/[^\d,.-]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount <= 9999999999.99 ? Math.round(amount * 100) / 100 : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (iso) {
    const result = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    const date = new Date(`${result}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === result ? result : null;
  }
  if (us) {
    const year = Number(us[3]) < 100 ? `20${us[3].padStart(2, '0')}` : us[3];
    const result = `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    const date = new Date(`${result}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === result ? result : null;
  }
  return null;
}

function normalizeTextractExpense(response) {
  const document = response?.ExpenseDocuments?.[0];
  const summaries = document?.SummaryFields || [];
  const findField = (...types) => summaries.find(field => types.includes(field?.Type?.Text));
  const value = field => field?.ValueDetection?.Text || field?.LabelDetection?.Text || null;
  const confidence = field => Number.isFinite(Number(field?.ValueDetection?.Confidence))
    ? Math.round(Number(field.ValueDetection.Confidence) * 100) / 100 : null;
  const merchantField = findField('VENDOR_NAME', 'RECEIVER_NAME');
  const dateField = findField('INVOICE_RECEIPT_DATE');
  const subtotalField = findField('SUBTOTAL');
  const taxField = findField('TAX');
  const totalField = findField('TOTAL');
  const currencyField = findField('CURRENCY');
  const currencyValue = value(currencyField);
  const currencyCode = currencyField?.ValueDetection?.Currency?.Code || currencyValue;
  const items = (document?.LineItemGroups || []).flatMap(group => group?.LineItems || []).map(item => {
    const fields = item?.LineItemExpenseFields || [];
    const get = (...types) => fields.find(field => types.includes(field?.Type?.Text));
    const description = get('ITEM', 'DESCRIPTION');
    const quantity = get('QUANTITY');
    const unitPrice = get('UNIT_PRICE');
    const totalPrice = get('PRICE', 'AMOUNT');
    return {
      description: cleanText(value(description), 255),
      quantity: numberFromText(value(quantity)),
      unitPrice: numberFromText(value(unitPrice)),
      totalPrice: numberFromText(value(totalPrice)),
      confidence: confidence(description),
    };
  }).filter(item => item.description || item.totalPrice !== null);
  const confidenceScores = {
    merchant: confidence(merchantField), receiptDate: confidence(dateField),
    subtotal: confidence(subtotalField), tax: confidence(taxField), total: confidence(totalField),
  };
  return {
    merchant: cleanText(value(merchantField)),
    receiptDate: normalizeDate(value(dateField)),
    subtotal: numberFromText(value(subtotalField)),
    tax: numberFromText(value(taxField)),
    total: numberFromText(value(totalField)),
    currency: typeof currencyCode === 'string' && /^[A-Z]{3}$/.test(currencyCode.trim()) ? currencyCode.trim() : null,
    items,
    confidence: confidenceScores,
  };
}

async function scanReceipt(fileBuffer, textractClient, AnalyzeExpenseCommand) {
  const result = await textractClient.send(new AnalyzeExpenseCommand({ Document: { Bytes: fileBuffer } }));
  return normalizeTextractExpense(result);
}

async function prepareReceiptForTextract(file) {
  validateReceiptFile(file);
  const image = sharp(file.buffer, { limitInputPixels: 40000000 });
  const metadata = await image.metadata();
  const expectedFormat = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[file.mimetype];
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || metadata.width * metadata.height > 40000000) {
    throw new TypeError('The uploaded file is not a valid supported image.');
  }
  if (file.mimetype !== 'image/webp') return file.buffer;
  const converted = await image.png().toBuffer();
  if (converted.length > 9 * 1024 * 1024) throw new RangeError('The converted image is too large to scan.');
  return converted;
}

module.exports = { maxReceiptBytes, normalizeDate, normalizeTextractExpense, numberFromText, prepareReceiptForTextract, scanReceipt, supportedTypes, validateReceiptFile };
