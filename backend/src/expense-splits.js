function amountToCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('Each allocation must be a nonnegative amount with at most two decimals.');
  }
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new TypeError('Each allocation must be a nonnegative amount with at most two decimals.');
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new TypeError('Each allocation is too large.');
  return cents;
}

function percentageToUnits(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('Each percentage must be a nonnegative value with at most two decimals.');
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new TypeError('Each percentage must be a nonnegative value with at most two decimals.');
  const units = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(units)) throw new TypeError('Each percentage is too large.');
  return units;
}

function allocatePercentageCents(totalCents, participants, ids) {
  const weights = participants.map(participant => percentageToUnits(participant.percentage));
  if (weights.reduce((sum, weight) => sum + weight, 0) !== 10000) {
    throw new TypeError('Participant percentages must add up to exactly 100%.');
  }
  const total = BigInt(totalCents);
  const denominator = 10000n;
  const shares = weights.map((weight, index) => {
    const product = total * BigInt(weight);
    return {
      personId: ids[index],
      cents: Number(product / denominator),
      remainder: product % denominator,
      index,
    };
  });
  let remaining = totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
  const remainderOrder = [...shares].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; remaining > 0; index++, remaining--) {
    remainderOrder[index % remainderOrder.length].cents++;
  }
  return shares.map(({ personId, cents }) => ({ personId, cents }));
}

function allocateExpenseSplits(totalCents, participants, splitMethod = 'equal') {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || !Array.isArray(participants) || !participants.length) {
    throw new TypeError('A positive expense amount and at least one participant are required.');
  }
  const ids = participants.map(participant => Number(
    ['exact', 'percentage'].includes(splitMethod) ? participant?.personId : participant
  ));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new TypeError('Participant IDs must be valid and unique.');
  }
  if (splitMethod === 'equal') {
    const base = Math.floor(totalCents / ids.length);
    const remainder = totalCents % ids.length;
    return ids.map((personId, index) => ({ personId, cents: base + (index < remainder ? 1 : 0) }));
  }
  if (splitMethod === 'percentage') return allocatePercentageCents(totalCents, participants, ids);
  if (splitMethod !== 'exact') throw new TypeError('Split method must be equal, exact, or percentage.');
  const allocations = participants.map((participant, index) => ({
    personId: ids[index],
    cents: amountToCents(participant.amount),
  }));
  if (allocations.reduce((sum, allocation) => sum + allocation.cents, 0) !== totalCents) {
    throw new TypeError('Exact participant allocations must equal the expense total.');
  }
  return allocations;
}

module.exports = { amountToCents, allocateExpenseSplits, percentageToUnits };
