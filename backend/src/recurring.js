const frequencyMonths = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};
const { allocateExpenseSplits } = require('./expense-splits');

function dateOnly(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('A valid YYYY-MM-DD date is required.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError('A valid YYYY-MM-DD date is required.');
  }
  return value;
}

function nextOccurrenceDate(value, frequency, anchorMonth, anchorDay) {
  const date = dateOnly(value);
  if (frequency === 'weekly') {
    const next = new Date(`${date}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    return next.toISOString().slice(0, 10);
  }
  const months = frequencyMonths[frequency];
  if (!months) throw new TypeError('Unsupported recurring expense frequency.');

  const [year, month] = date.split('-').map(Number);
  const nextMonthIndex = year * 12 + month - 1 + months;
  const nextYear = Math.floor(nextMonthIndex / 12);
  const nextMonth = nextMonthIndex % 12 + 1;
  const requestedMonth = Number(anchorMonth) || month;
  const requestedDay = Number(anchorDay) || Number(date.slice(8, 10));
  const targetMonthIndex = frequency === 'yearly'
    ? nextYear * 12 + requestedMonth - 1
    : nextMonthIndex;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(requestedDay, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

function splitExpenseAmount(amount, participantIds, splitMethod = 'equal', percentages = []) {
  const totalCents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 ||
      !Array.isArray(participantIds) || !participantIds.length ||
      new Set(participantIds).size !== participantIds.length) {
    throw new TypeError('A positive amount and unique participants are required.');
  }
  if (splitMethod === 'equal') {
    return allocateExpenseSplits(totalCents, participantIds, 'equal').map(({ personId, cents }) => ({
      personId,
      amount: cents / 100,
    }));
  }
  if (splitMethod !== 'custom' || !Array.isArray(percentages) || percentages.length !== participantIds.length) {
    throw new TypeError('A valid split method and share percentages are required.');
  }
  const weights = percentages.map(Number);
  if (weights.some(weight => !Number.isFinite(weight) || weight <= 0) ||
      Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) > 0.01) {
    throw new TypeError('Custom split shares must add up to 100%.');
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const cents = weights.map(weight => Math.floor(totalCents * weight / totalWeight));
  let remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % cents.length) {
    cents[index] += 1;
    remainder -= 1;
  }
  return participantIds.map((personId, index) => ({
    personId,
    amount: cents[index] / 100,
  }));
}

async function reserveOccurrence(executor, templateId, occurrenceDate) {
  try {
    const [result] = await executor.execute(
      `INSERT INTO recurring_expense_occurrences(template_id, occurrence_date, status)
     VALUES(?, ?, 'processing')`,
      [templateId, dateOnly(occurrenceDate)]
    );
    return result.affectedRows === 1;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return false;
    throw error;
  }
}

async function createExpenseAndSplits(executor, template, occurrenceDate, enteredAmount, baseAmount, participants) {
  const allocations = splitExpenseAmount(
    baseAmount,
    participants.map(participant => participant.person_id),
    template.split_method,
    participants.map(participant => participant.share_percent)
  );
  const [expense] = await executor.execute(
    `INSERT INTO expenses(group_id, title, amount, paid_by, category, split_method, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [
      template.group_id,
      template.title,
      baseAmount,
      template.paid_by,
      template.category,
      template.split_method === 'custom' ? 'exact' : 'equal',
      `${dateOnly(occurrenceDate)} 12:00:00`,
    ]
  );
  for (const allocation of allocations) {
    await executor.execute(
      'INSERT INTO splits(expense_id, person_id, amount) VALUES(?, ?, ?)',
      [expense.insertId, allocation.personId, allocation.amount]
    );
  }
  await executor.execute(
    `UPDATE recurring_expense_occurrences
     SET status = 'generated', expense_id = ?, entered_amount = ?, base_amount = ?,
         generated_at = UTC_TIMESTAMP()
     WHERE template_id = ? AND occurrence_date = ?`,
    [expense.insertId, enteredAmount, baseAmount, template.id, dateOnly(occurrenceDate)]
  );
  return expense.insertId;
}

module.exports = {
  createExpenseAndSplits,
  dateOnly,
  nextOccurrenceDate,
  reserveOccurrence,
  splitExpenseAmount,
};
