const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateWorkspaceBalanceLedger } = require('../src/personal-balances');

const obligation = (debtorId, creditorId, amountCents) => ({
  debtor_id: debtorId,
  creditor_id: creditorId,
  amount_cents: amountCents,
});

test('reports gross amounts owed to the current user when only receivables exist', () => {
  const result = calculateWorkspaceBalanceLedger(1, [
    obligation(2, 1, 1_000_000),
    obligation(3, 1, 782_400),
  ]);

  assert.equal(result.owedToMeCents, 1_782_400);
  assert.equal(result.owedByMeCents, 0);
  assert.equal(result.netBalanceCents, 1_782_400);
  assert.equal(result.balanceByPersonCents.get(1), -1_782_400);
});

test('reports gross amounts the current user owes when only payables exist', () => {
  const result = calculateWorkspaceBalanceLedger(1, [obligation(1, 2, 600_000)]);

  assert.equal(result.owedToMeCents, 0);
  assert.equal(result.owedByMeCents, 600_000);
  assert.equal(result.netBalanceCents, -600_000);
  assert.equal(result.balanceByPersonCents.get(1), 600_000);
});

test('keeps gross receivables and payables separate while calculating the net', () => {
  const result = calculateWorkspaceBalanceLedger(1, [
    obligation(2, 1, 1_782_400),
    obligation(1, 3, 600_000),
  ]);

  assert.deepEqual({
    owedToMeCents: result.owedToMeCents,
    owedByMeCents: result.owedByMeCents,
    netBalanceCents: result.netBalanceCents,
  }, {
    owedToMeCents: 1_782_400,
    owedByMeCents: 600_000,
    netBalanceCents: 1_182_400,
  });
});

test('settlements reduce the matching pair obligation and reciprocal debts net once', () => {
  const result = calculateWorkspaceBalanceLedger(1, [
    obligation(1, 2, 800_000),
    obligation(1, 2, -200_000), // A recorded settlement reduces this payable.
    obligation(2, 1, 100_000), // Reverse-direction debt offsets the same pair.
  ]);

  assert.equal(result.owedToMeCents, 0);
  assert.equal(result.owedByMeCents, 500_000);
  assert.equal(result.netBalanceCents, -500_000);
  assert.equal(result.balanceByPersonCents.get(2), -500_000);
});

test('rejects invalid IDs and non-integer paise amounts', () => {
  assert.throws(() => calculateWorkspaceBalanceLedger(0, []), /valid person ID/);
  assert.throws(() => calculateWorkspaceBalanceLedger(1, [obligation(1, 2, 1.5)]), /integer paise/);
});
