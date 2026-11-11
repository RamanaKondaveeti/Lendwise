import test from 'node:test'
import assert from 'node:assert/strict'
import { isSupportedCurrency, supportedCurrencies } from '../src/currencies.mjs'

test('supported currency choices are accepted consistently', () => {
  assert.equal(supportedCurrencies.length, 9)
  for (const currency of supportedCurrencies) assert.equal(isSupportedCurrency(currency), true)
  assert.equal(isSupportedCurrency('XYZ'), false)
})
