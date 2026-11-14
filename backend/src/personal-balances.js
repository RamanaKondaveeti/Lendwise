function calculateWorkspaceBalanceLedger(personId, pairBalances) {
  const targetId = Number(personId);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    throw new TypeError('A valid person ID is required.');
  }

  // Each pair is normalized to low-ID owes high-ID. Positive paise mean the
  // low-ID person owes the high-ID person; negative values mean the reverse.
  const normalizedPairs = new Map();
  for (const row of pairBalances) {
    const debtorId = Number(row.debtor_id);
    const creditorId = Number(row.creditor_id);
    const amountCents = Number(row.amount_cents);
    if (!Number.isSafeInteger(debtorId) || debtorId <= 0 ||
        !Number.isSafeInteger(creditorId) || creditorId <= 0 || debtorId === creditorId ||
        !Number.isSafeInteger(amountCents)) {
      throw new TypeError('Pair balances must contain valid person IDs and integer paise amounts.');
    }
    const lowId = Math.min(debtorId, creditorId);
    const highId = Math.max(debtorId, creditorId);
    const key = `${lowId}:${highId}`;
    const direction = debtorId === lowId ? 1 : -1;
    normalizedPairs.set(key, (normalizedPairs.get(key) || 0) + direction * amountCents);
  }

  let owedToMeCents = 0;
  let owedByMeCents = 0;
  const balanceByPersonCents = new Map([[targetId, 0]]);
  for (const [key, signedCents] of normalizedPairs) {
    const [lowId, highId] = key.split(':').map(Number);
    balanceByPersonCents.set(lowId, (balanceByPersonCents.get(lowId) || 0) + signedCents);
    balanceByPersonCents.set(highId, (balanceByPersonCents.get(highId) || 0) - signedCents);
    if (targetId === lowId || targetId === highId) {
      const targetOwes = targetId === lowId ? signedCents : -signedCents;
      if (targetOwes > 0) owedByMeCents += targetOwes;
      else owedToMeCents -= targetOwes;
    }
  }

  return {
    balanceByPersonCents,
    owedToMeCents,
    owedByMeCents,
    netBalanceCents: owedToMeCents - owedByMeCents,
  };
}

module.exports = { calculateWorkspaceBalanceLedger };
