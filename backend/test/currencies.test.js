const test = require('node:test');
const assert = require('node:assert/strict');
const { supportedCurrencies, isSupportedCurrency } = require('../src/currencies');
const { convertBudgetAmountToBase } = require('../src/budgets');

test('supported currencies include INR and multiple display currencies', () => {
  assert.deepEqual(supportedCurrencies, ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'JPY', 'CHF']);
  for (const code of supportedCurrencies) assert.equal(isSupportedCurrency(code), true);
  assert.equal(isSupportedCurrency('XYZ'), false);
});

test('budget conversion accepts supported foreign currencies using INR rates', () => {
  assert.deepEqual(convertBudgetAmountToBase(10, 'EUR', 90), { amount: 900, exchangeRateToInr: 90 });
  assert.throws(() => convertBudgetAmountToBase(10, 'XYZ', 1), /valid currency/);
});
