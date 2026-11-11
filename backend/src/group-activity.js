const activityTypes = new Set(['all', 'expense', 'settlement', 'trip', 'edit', 'delete']);

function normalizeActivityQuery(query = {}) {
  const type = query.type || 'all';
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!activityTypes.has(type)) throw new TypeError('Choose a valid activity type.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Limit must be between 1 and 100.');
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new TypeError('Offset must be a non-negative integer.');
  const startDate = query.startDate || null;
  const endDate = query.endDate || null;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) throw new TypeError('Dates must use YYYY-MM-DD format.');
  if (startDate && endDate && startDate > endDate) throw new TypeError('Start date must be on or before end date.');
  return { type, startDate, endDate, limit, offset };
}

function activityTypeClause(type, alias = 'activity_type') {
  const clauses = {
    all: null,
    expense: [`${alias} IN ('expense_created', 'expense_edited', 'expense_deleted')`, []],
    settlement: [`${alias} = 'settlement_recorded'`, []],
    trip: [`${alias} IN ('trip_created', 'trip_updated', 'trip_cancelled')`, []],
    edit: [`${alias} IN ('expense_edited', 'trip_updated')`, []],
    delete: [`${alias} = 'expense_deleted'`, []],
  };
  return clauses[type] || null;
}

module.exports = { normalizeActivityQuery, activityTypeClause };
