function validateGroupSettlement(payerBalanceCents, payeeBalanceCents, amountCents) {
  return Number.isSafeInteger(payerBalanceCents) &&
    Number.isSafeInteger(payeeBalanceCents) &&
    Number.isSafeInteger(amountCents) &&
    payerBalanceCents > 0 &&
    payeeBalanceCents < 0 &&
    amountCents > 0 &&
    amountCents <= Math.min(payerBalanceCents, -payeeBalanceCents);
}

function calculateMinimalSettlements(people) {
  if (!Array.isArray(people)) throw new TypeError('Balances must be an array.');

  const members = people.map(person => {
    const balanceCents = Math.round(Number(person.balance) * 100);
    if (!Number.isInteger(person.id) || !Number.isSafeInteger(balanceCents)) {
      throw new TypeError('Each balance requires a valid person ID and amount.');
    }
    return { ...person, balanceCents };
  });
  if (new Set(members.map(person => person.id)).size !== members.length) {
    throw new TypeError('Person IDs must be unique.');
  }

  const totalCents = members.reduce((total, person) => total + person.balanceCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents !== 0) {
    throw new RangeError('Group credits and debits must balance to the cent.');
  }

  const activeMembers = members.filter(person => person.balanceCents !== 0);
  const initialBalances = activeMembers.map(person => person.balanceCents);
  const minimumCountMemo = new Map();

  function minimumCount(balances) {
    const key = balances.join(',');
    if (minimumCountMemo.has(key)) return minimumCountMemo.get(key);

    let first = -1;
    for (let index = 0; index < balances.length; index += 1) {
      if (balances[index] !== 0 &&
          (first === -1 || Math.abs(balances[index]) > Math.abs(balances[first]))) {
        first = index;
      }
    }
    if (first === -1) return 0;

    let best = Infinity;
    const triedBalances = new Set();
    const candidates = balances
      .map((balance, index) => ({ balance, index }))
      .filter(({ balance, index }) => balance !== 0 && Math.sign(balance) !== Math.sign(balances[first]) && index !== first)
      .sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance));

    for (const candidate of candidates) {
      if (triedBalances.has(candidate.balance)) continue;
      triedBalances.add(candidate.balance);

      const next = balances.slice();
      const transfer = Math.min(Math.abs(next[first]), Math.abs(next[candidate.index]));
      next[first] -= Math.sign(next[first]) * transfer;
      next[candidate.index] -= Math.sign(next[candidate.index]) * transfer;
      best = Math.min(best, 1 + minimumCount(next));
    }

    minimumCountMemo.set(key, best);
    return best;
  }

  const result = [];
  const balances = initialBalances.slice();
  while (balances.some(balance => balance !== 0)) {
    let first = -1;
    for (let index = 0; index < balances.length; index += 1) {
      if (balances[index] !== 0 &&
          (first === -1 || Math.abs(balances[index]) > Math.abs(balances[first]))) {
        first = index;
      }
    }

    const candidates = balances
      .map((balance, index) => ({ balance, index }))
      .filter(({ balance, index }) => balance !== 0 && Math.sign(balance) !== Math.sign(balances[first]) && index !== first)
      .sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance));
    const triedBalances = new Set();
    const currentMinimum = minimumCount(balances);
    let selected = null;
    let nextBalances = null;

    for (const candidate of candidates) {
      if (triedBalances.has(candidate.balance)) continue;
      triedBalances.add(candidate.balance);
      const next = balances.slice();
      const transfer = Math.min(Math.abs(next[first]), Math.abs(next[candidate.index]));
      next[first] -= Math.sign(next[first]) * transfer;
      next[candidate.index] -= Math.sign(next[candidate.index]) * transfer;
      if (1 + minimumCount(next) === currentMinimum) {
        selected = { ...candidate, transfer };
        nextBalances = next;
        break;
      }
    }

    if (!selected) throw new Error('Could not construct the minimum settlement plan.');

    const payerIndex = balances[first] > 0 ? first : selected.index;
    const payeeIndex = balances[first] < 0 ? first : selected.index;
    const amount = selected.transfer / 100;
    result.push({
      payerId: activeMembers[payerIndex].id,
      payer: activeMembers[payerIndex].name,
      payeeId: activeMembers[payeeIndex].id,
      payee: activeMembers[payeeIndex].name,
      amount,
      payerRemaining: Math.max(0, nextBalances[payerIndex]) / 100,
      payeeRemaining: Math.max(0, -nextBalances[payeeIndex]) / 100,
    });
    for (let index = 0; index < balances.length; index += 1) balances[index] = nextBalances[index];
  }

  return result;
}

module.exports = { calculateMinimalSettlements, validateGroupSettlement };
