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

function positiveShareCount(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new TypeError('Each share count must be a positive whole number.');
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new TypeError('Each share count must be a positive whole number.');
  const count = BigInt(text);
  if (count <= 0n) throw new TypeError('Each share count must be greater than zero.');
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('Each share count is too large.');
  return count;
}

function quantityToMillis(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('Item quantity must be a positive value with up to three decimal places.');
  }
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(value).trim());
  if (!match) throw new TypeError('Item quantity must be a positive value with up to three decimal places.');
  const millis = Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0'));
  if (!Number.isSafeInteger(millis) || millis <= 0) throw new TypeError('Item quantity must be greater than zero.');
  return millis;
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

function allocateSharesCents(totalCents, participants, ids) {
  const weights = participants.map(participant => positiveShareCount(participant.shares));
  const totalShares = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalShares <= 0n) throw new TypeError('Total shares must be greater than zero.');
  const total = BigInt(totalCents);
  const shares = weights.map((weight, index) => {
    const product = total * weight;
    return {
      personId: ids[index],
      cents: Number(product / totalShares),
      remainder: product % totalShares,
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
    ['exact', 'percentage', 'shares'].includes(splitMethod) ? participant?.personId : participant
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
  if (splitMethod === 'shares') return allocateSharesCents(totalCents, participants, ids);
  if (splitMethod !== 'exact') throw new TypeError('Split method must be equal, exact, percentage, or shares.');
  const allocations = participants.map((participant, index) => ({
    personId: ids[index],
    cents: amountToCents(participant.amount),
  }));
  if (allocations.reduce((sum, allocation) => sum + allocation.cents, 0) !== totalCents) {
    throw new TypeError('Exact participant allocations must equal the expense total.');
  }
  return allocations;
}

function allocateItemWiseSplits(expenseTotalCents, items) {
  if (!Number.isSafeInteger(expenseTotalCents) || expenseTotalCents <= 0 || !Array.isArray(items) || !items.length) {
    throw new TypeError('Add at least one valid item.');
  }
  const normalizedItems = items.map((item, index) => {
    if (!item || typeof item.itemName !== 'string' || !item.itemName.trim() || item.itemName.trim().length > 255) {
      throw new TypeError(`Item ${index + 1} needs a name of 1 to 255 characters.`);
    }
    const quantityMillis = quantityToMillis(item.quantity);
    if (quantityMillis > 9999999999) throw new TypeError(`Item ${index + 1} quantity is too large.`);
    const unitPriceCents = amountToCents(item.unitPrice);
    if (unitPriceCents > 999999999999) throw new TypeError(`Item ${index + 1} unit price is too large.`);
    const totalBigCents = (BigInt(unitPriceCents) * BigInt(quantityMillis) + 500n) / 1000n;
    if (totalBigCents > 999999999999n) throw new TypeError(`Item ${index + 1} total is too large.`);
    const totalCents = Number(totalBigCents);
    if (!Number.isSafeInteger(totalCents)) throw new TypeError(`Item ${index + 1} total is too large.`);
    const method = item.allocationMethod;
    if (!['equal', 'exact', 'percentage', 'shares'].includes(method)) {
      throw new TypeError(`Item ${index + 1} has an invalid allocation method.`);
    }
    const participants = item.participants;
    let allocations;
    if (totalCents > 0) {
      allocations = allocateExpenseSplits(totalCents, participants, method);
    } else if (method === 'exact') {
      if (!Array.isArray(participants) || !participants.length) throw new TypeError('At least one participant is required for each item.');
      const ids = participants.map(participant => Number(participant?.personId));
      if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length ||
          participants.some(participant => amountToCents(participant?.amount) !== 0)) {
        throw new TypeError('Zero-priced items need unique participants with zero exact allocations.');
      }
      allocations = ids.map(personId => ({ personId, cents: 0 }));
    } else {
      const validated = allocateExpenseSplits(1, participants, method);
      allocations = validated.map(({ personId }) => ({ personId, cents: 0 }));
    }
    return {
      itemName: item.itemName.trim(),
      quantityMillis,
      unitPriceCents,
      totalCents,
      allocationMethod: method,
      allocations,
    };
  });
  if (normalizedItems.reduce((sum, item) => sum + item.totalCents, 0) !== expenseTotalCents) {
    throw new TypeError('Item totals must equal the expense total exactly.');
  }
  const totals = new Map();
  for (const item of normalizedItems) {
    for (const allocation of item.allocations) {
      totals.set(allocation.personId, (totals.get(allocation.personId) || 0) + allocation.cents);
    }
  }
  const aggregateAllocations = [...totals].map(([personId, cents]) => ({ personId, cents }));
  if (aggregateAllocations.reduce((sum, allocation) => sum + allocation.cents, 0) !== expenseTotalCents) {
    throw new TypeError('Item allocations must equal the expense total exactly.');
  }
  return { items: normalizedItems, allocations: aggregateAllocations };
}

module.exports = { amountToCents, allocateExpenseSplits, allocateItemWiseSplits, percentageToUnits, positiveShareCount, quantityToMillis };
