const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateMinimalSettlements,
  validateGroupSettlement,
} = require('../src/settlements');

function members(balances) {
  return balances.map((balance, index) => ({
    id: index + 1,
    name: `Member ${index + 1}`,
    balance,
  }));
}

test('finds the minimum number of transfers across separate balanced subsets', () => {
  const plan = calculateMinimalSettlements(members([4, 3, 2, -5, -4]));

  assert.equal(plan.length, 3);
  assert.equal(plan.reduce((total, payment) => total + payment.amount, 0), 9);
});

test('excludes zero balances and accounts for settlements already reflected in balances', () => {
  const plan = calculateMinimalSettlements(members([0, 7.5, -2.5, -5]));

  assert.equal(plan.length, 2);
  assert.ok(plan.every(payment => payment.payerId !== 1 && payment.payeeId !== 1));
  assert.equal(plan.reduce((total, payment) => total + payment.amount, 0), 7.5);
  assert.equal(plan.at(-1).payerRemaining + plan.at(-1).payeeRemaining, 0);
});

test('recalculates the remaining plan after a partial settlement is recorded', () => {
  const before = calculateMinimalSettlements(members([10, -6, -4]));
  const firstPayment = before[0];
  const after = calculateMinimalSettlements(members([
    10 - firstPayment.amount,
    -6 + (firstPayment.payeeId === 2 ? firstPayment.amount : 0),
    -4 + (firstPayment.payeeId === 3 ? firstPayment.amount : 0),
  ]));

  assert.equal(after.length, before.length - 1);
  assert.equal(after.reduce((total, payment) => total + payment.amount, 0), 10 - firstPayment.amount);
});

test('never exceeds the payer debt or recipient credit and reports remaining balances', () => {
  const plan = calculateMinimalSettlements(members([10, -6, -4]));
  const remaining = new Map([[1, 10], [2, -6], [3, -4]]);

  for (const payment of plan) {
    assert.ok(payment.amount <= remaining.get(payment.payerId));
    assert.ok(payment.amount <= -remaining.get(payment.payeeId));
    remaining.set(payment.payerId, remaining.get(payment.payerId) - payment.amount);
    remaining.set(payment.payeeId, remaining.get(payment.payeeId) + payment.amount);
  }
  assert.ok([...remaining.values()].every(balance => balance === 0));
});

test('rejects group balances whose credits and debits do not reconcile', () => {
  assert.throws(
    () => calculateMinimalSettlements(members([10, -9.99])),
    /credits and debits must balance/
  );
});

test('rejects balance values with sub-paisa precision instead of rounding them', () => {
  assert.throws(() => calculateMinimalSettlements(members([1.001, -1])), /valid person ID and amount/);
});

test('allows partial group settlements only within both outstanding balances', () => {
  assert.equal(validateGroupSettlement(1000, -800, 350), true);
  assert.equal(validateGroupSettlement(1000, -800, 801), false);
  assert.equal(validateGroupSettlement(300, -800, 301), false);
  assert.equal(validateGroupSettlement(0, -800, 100), false);
  assert.equal(validateGroupSettlement(1000, 800, 100), false);
});
