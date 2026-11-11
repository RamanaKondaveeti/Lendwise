const test = require('node:test');
const assert = require('node:assert/strict');
const { expenseVoidRejection } = require('../src/expense-void');

test('allows a group member to void an active expense with no linked settlements', () => {
  assert.equal(expenseVoidRejection({
    isGroupMember: true,
    alreadyVoided: false,
    hasLinkedSettlements: false,
  }), null);
});

test('rejects voiding by a person who is not a current group member', () => {
  assert.equal(expenseVoidRejection({
    isGroupMember: false,
    alreadyVoided: false,
    hasLinkedSettlements: false,
  }).status, 403);
});

test('rejects voiding when expense-linked settlement history exists', () => {
  const rejection = expenseVoidRejection({
    isGroupMember: true,
    alreadyVoided: false,
    hasLinkedSettlements: true,
  });
  assert.equal(rejection.status, 409);
  assert.match(rejection.error, /recorded payments/);
});

test('rejects voiding an expense that is already voided', () => {
  assert.equal(expenseVoidRejection({
    isGroupMember: true,
    alreadyVoided: true,
    hasLinkedSettlements: false,
  }).status, 409);
});
