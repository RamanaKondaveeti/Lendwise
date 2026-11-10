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

function allocateExpenseSplits(totalCents, participants, splitMethod = 'equal') {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || !Array.isArray(participants) || !participants.length) {
    throw new TypeError('A positive expense amount and at least one participant are required.');
  }
  const ids = participants.map(participant => Number(splitMethod === 'exact' ? participant?.personId : participant));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new TypeError('Participant IDs must be valid and unique.');
  }
  if (splitMethod === 'equal') {
    const base = Math.floor(totalCents / ids.length);
    const remainder = totalCents % ids.length;
    return ids.map((personId, index) => ({ personId, cents: base + (index < remainder ? 1 : 0) }));
  }
  if (splitMethod !== 'exact') throw new TypeError('Split method must be equal or exact.');
  const allocations = participants.map((participant, index) => ({
    personId: ids[index],
    cents: amountToCents(participant.amount),
  }));
  if (allocations.reduce((sum, allocation) => sum + allocation.cents, 0) !== totalCents) {
    throw new TypeError('Exact participant allocations must equal the expense total.');
  }
  return allocations;
}

module.exports = { amountToCents, allocateExpenseSplits };
