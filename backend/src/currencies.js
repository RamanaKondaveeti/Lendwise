const supportedCurrencies = Object.freeze(['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'JPY', 'CHF']);
const currencyEnumSql = supportedCurrencies.map(code => `'${code}'`).join(', ');

function isSupportedCurrency(currency) {
  return supportedCurrencies.includes(currency);
}

module.exports = { supportedCurrencies, currencyEnumSql, isSupportedCurrency };
