import test from 'node:test'
import assert from 'node:assert/strict'
import { readAuthLink } from '../src/auth-link.mjs'

test('reads bearer invitation tokens from fragments and removes them from the browser URL', () => {
  const result = readAuthLink('https://groupbuk.example/app?campaign=spring#invite=secret-token')
  assert.equal(result.invite, 'secret-token')
  assert.equal(result.reset, null)
  assert.equal(result.shouldClean, true)
  assert.equal(result.cleanUrl, '/app?campaign=spring')
})

test('reads reset tokens from fragments and preserves unrelated fragment state', () => {
  const result = readAuthLink('https://groupbuk.example/#tab=login&reset=secret-token')
  assert.equal(result.reset, 'secret-token')
  assert.equal(result.cleanUrl, '/#tab=login')
})

test('continues to accept old query links and removes their bearer tokens', () => {
  const result = readAuthLink('https://groupbuk.example/?invite=legacy-token&campaign=spring')
  assert.equal(result.invite, 'legacy-token')
  assert.equal(result.cleanUrl, '/?campaign=spring')
})

test('does not rewrite ordinary URLs', () => {
  const result = readAuthLink('https://groupbuk.example/?campaign=spring#overview')
  assert.equal(result.shouldClean, false)
  assert.equal(result.cleanUrl, '/?campaign=spring#overview')
})
