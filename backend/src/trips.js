const { isValidReportDate } = require('./reports');

function validTripInput(body = {}, partial = false) {
  const status = body.status ?? 'planned';
  const hasDates = body.startDate !== undefined || body.endDate !== undefined;
  const datesValid = !hasDates || (
    (body.startDate === undefined || isValidReportDate(body.startDate)) &&
    (body.endDate === undefined || isValidReportDate(body.endDate)) &&
    (!body.startDate || !body.endDate || body.endDate >= body.startDate)
  );
  return (partial || (typeof body.name === 'string' && body.name.trim().length > 0)) &&
    (partial || Boolean(isValidReportDate(body.startDate) && isValidReportDate(body.endDate) && body.startDate && body.endDate)) &&
    (body.name === undefined || (typeof body.name === 'string' && body.name.trim().length <= 255)) &&
    (body.destination === undefined || body.destination === null || (typeof body.destination === 'string' && body.destination.length <= 255)) &&
    (body.description === undefined || body.description === null || (typeof body.description === 'string' && body.description.length <= 5000)) &&
    datesValid && ['planned', 'active', 'completed', 'cancelled'].includes(status) &&
    (body.budgetAmount === undefined || body.budgetAmount === null ||
      (typeof body.budgetAmount === 'number' && Number.isFinite(body.budgetAmount) && body.budgetAmount >= 0 && body.budgetAmount <= 9999999999.99 && Number.isSafeInteger(Math.round(body.budgetAmount * 100))));
}

module.exports = { validTripInput };
