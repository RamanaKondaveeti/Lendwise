export const supportedCurrencies = Object.freeze(['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'JPY', 'CHF'])

export function isSupportedCurrency(currency) {
  return supportedCurrencies.includes(currency)
}
