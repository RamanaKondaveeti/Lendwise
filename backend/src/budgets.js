const { isValidReportDate } = require('./reports');

function convertBudgetAmountToBase(amount, currency, exchangeRateToInr = 1) {
  const numericAmount = Number(amount);
  const rate = Number(exchangeRateToInr);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !['INR', 'USD'].includes(currency) ||
      !Number.isFinite(rate) || rate <= 0 || (currency === 'INR' && Math.abs(rate - 1) > 0.000001)) {
    throw new TypeError('Enter a positive amount with a valid currency exchange rate.');
  }
  const cents = Math.round(numericAmount * rate * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 999999999999) {
    throw new TypeError('Budget amount is outside the supported range.');
  }
  return { amount: cents / 100, exchangeRateToInr: rate };
}

function buildBudgetSpendQuery(budget, range) {
  const categoryCondition = budget.category ? ' AND e.category = ?' : '';
  const parameters = [budget.workspace_id];
  if (budget.budget_type === 'personal') {
    parameters.push(budget.person_id, `${range.startDate} 00:00:00`, `${range.endDate} 00:00:00`);
    if (budget.category) parameters.push(budget.category);
    return {
      sql: `SELECT COALESCE(SUM(s.amount), 0) AS spent
        FROM expenses e JOIN splits s ON s.expense_id = e.id
        JOIN \`groups\` g ON g.id = e.group_id AND g.workspace_id = ?
        WHERE s.person_id = ? AND e.created_at >= ? AND e.created_at < ?${categoryCondition}`,
      parameters,
    };
  }
  parameters.push(budget.group_id, `${range.startDate} 00:00:00`, `${range.endDate} 00:00:00`);
  if (budget.category) parameters.push(budget.category);
  return {
    sql: `SELECT COALESCE(SUM(e.amount), 0) AS spent
      FROM expenses e JOIN \`groups\` g ON g.id = e.group_id AND g.workspace_id = ?
      WHERE e.group_id = ? AND e.created_at >= ? AND e.created_at < ?${categoryCondition}`,
    parameters,
  };
}

async function getBudgetSpend(executor, budget, range) {
  const query = buildBudgetSpendQuery(budget, range);
  const [rows] = await executor.execute(query.sql, query.parameters);
  return Number(rows[0]?.spent || 0);
}

function budgetAlertThresholdsCrossed(configured, percentUsed) {
  const thresholds = [...new Set([...configured.map(Number), 80, 90, 100])];
  const crossed = thresholds.filter(value => Number.isFinite(value) && percentUsed >= value);
  if (percentUsed > 100) crossed.push('exceeded');
  return crossed;
}

function budgetAlertDedupeKey(budgetId, periodStart, threshold) {
  return `budget:${budgetId}:${periodStart}:${threshold}`;
}

function buildAccessibleBudgetQuery(budgetId, account) {
  return {
    sql: `SELECT b.*, DATE_FORMAT(b.start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(b.end_date, '%Y-%m-%d') AS end_date FROM budgets b
      WHERE b.id = ? AND b.workspace_id = ? AND b.is_active = TRUE
        AND ((b.budget_type = 'personal' AND b.person_id = ?)
          OR (b.budget_type = 'group' AND EXISTS (
            SELECT 1 FROM group_members gm WHERE gm.group_id = b.group_id AND gm.person_id = ?
          )))`,
    parameters: [budgetId, account.workspace_id, account.person_id, account.person_id],
  };
}

function currentPeriod(date, period) {
  const value = date instanceof Date ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    : new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) throw new TypeError('Invalid period date.');
  let start;
  let end;
  if (period === 'weekly') {
    start = new Date(value);
    const day = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - day);
    end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === 'monthly') {
    start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
    end = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
  } else if (period === 'yearly') {
    start = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(value.getUTCFullYear() + 1, 0, 1));
  } else throw new TypeError('Invalid budget period.');
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function periodRanges(budget, today = new Date()) {
  const anchor = budget.start_date instanceof Date
    ? budget.start_date.toISOString().slice(0, 10)
    : String(budget.start_date).slice(0, 10);
  const nowPeriod = currentPeriod(today, budget.period);
  const currentStart = anchor > nowPeriod.startDate ? anchor : nowPeriod.startDate;
  let next = currentPeriod(currentPeriod(today, budget.period).endDate, budget.period);
  const current = { startDate: currentStart, endDate: next.startDate };
  const previous = currentPeriod(new Date(`${current.startDate}T00:00:00.000Z`), budget.period);
  let effectiveEnd = current.endDate;
  if (budget.end_date) {
    const endExclusive = new Date(`${String(budget.end_date).slice(0, 10)}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const cap = endExclusive.toISOString().slice(0, 10);
    if (cap < effectiveEnd) effectiveEnd = cap;
  }
  current.endDate = effectiveEnd;
  return { current, previous };
}

function validateBudgetInput(body, partial = false) {
  const result = {};
  const fields = ['name', 'budgetType', 'groupId', 'category', 'amount', 'currency', 'period', 'startDate', 'endDate', 'alertThresholds'];
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Invalid budget.');
  if (partial && fields.some(key => Object.hasOwn(body, key))) {
    // Updates accept the same complete validated shape to avoid partial type transitions.
    partial = false;
  }
  if (!partial || Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) throw new TypeError('Enter a budget name up to 120 characters.');
    result.name = body.name.trim();
  }
  if (!partial || Object.hasOwn(body, 'budgetType')) {
    if (!['personal', 'group'].includes(body.budgetType)) throw new TypeError('Budget type must be personal or group.');
    result.budgetType = body.budgetType;
  }
  if (result.budgetType === 'group' || (!partial && body.budgetType === 'group')) {
    const groupId = Number(body.groupId);
    if (!Number.isInteger(groupId) || groupId <= 0) throw new TypeError('Choose a valid group.');
    result.groupId = groupId;
  }
  if (!partial || Object.hasOwn(body, 'category')) {
    if (body.category !== undefined && body.category !== null && (typeof body.category !== 'string' || !body.category.trim() || body.category.trim().length > 100)) throw new TypeError('Choose a valid category.');
    result.category = body.category ? body.category.trim() : null;
  }
  if (!partial || Object.hasOwn(body, 'amount')) {
    const currency = body.currency || 'INR';
    const rate = currency === 'INR' ? 1 : body.exchangeRateToInr;
    const converted = convertBudgetAmountToBase(body.amount, currency, rate);
    result.amount = converted.amount;
    result.exchangeRateToInr = converted.exchangeRateToInr;
  }
  if (!partial || Object.hasOwn(body, 'currency')) {
    if (!['INR', 'USD'].includes(body.currency || 'INR')) throw new TypeError('Currency must be INR or USD.');
    result.currency = body.currency || 'INR';
  }
  if (!partial || Object.hasOwn(body, 'period')) {
    if (!['weekly', 'monthly', 'yearly'].includes(body.period)) throw new TypeError('Choose weekly, monthly, or yearly.');
    result.period = body.period;
  }
  if (!partial || Object.hasOwn(body, 'startDate')) {
    if (!isValidReportDate(body.startDate)) throw new TypeError('Choose a valid start date.');
    result.startDate = body.startDate;
  }
  if (!partial || Object.hasOwn(body, 'endDate')) {
    if (body.endDate && !isValidReportDate(body.endDate)) throw new TypeError('Choose a valid end date.');
    if (body.endDate && body.startDate && body.endDate < body.startDate) throw new TypeError('End date must be on or after the start date.');
    result.endDate = body.endDate || null;
  }
  if (!partial || Object.hasOwn(body, 'alertThresholds')) {
    const thresholds = body.alertThresholds === undefined ? [80, 90, 100] : body.alertThresholds;
    if (!Array.isArray(thresholds) || thresholds.length > 10 || thresholds.some(value => !Number.isInteger(value) || value < 1 || value > 1000)) throw new TypeError('Alert thresholds must be whole percentages from 1 to 1000.');
    result.alertThresholds = [...new Set(thresholds)].sort((a, b) => a - b);
  }
  return result;
}

module.exports = {
  buildAccessibleBudgetQuery,
  buildBudgetSpendQuery,
  budgetAlertDedupeKey,
  budgetAlertThresholdsCrossed,
  convertBudgetAmountToBase,
  currentPeriod,
  getBudgetSpend,
  periodRanges,
  validateBudgetInput,
};
