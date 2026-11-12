const { isValidReportDate } = require('./reports');

function buildGroupAnalyticsFilter({ groupId, period = '30d', startDate, endDate }) {
  const periods = new Set(['7d', '30d', '90d', 'all']);
  if (!periods.has(period) || !isValidReportDate(startDate ?? null) || !isValidReportDate(endDate ?? null) ||
      (startDate && endDate && startDate > endDate)) {
    throw new TypeError('Invalid analytics filters.');
  }

  const clauses = ['e.group_id = ?', 'e.voided_at IS NULL'];
  const parameters = groupId === undefined ? [] : [groupId];
  if (startDate || endDate) {
    if (startDate) {
      clauses.push('e.created_at >= ?');
      parameters.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      clauses.push('e.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      parameters.push(endDate);
    }
  } else if (period !== 'all') {
    clauses.push('e.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)');
    parameters.push(Number(period.slice(0, -1)));
  }
  return { where: clauses.join(' AND '), parameters };
}

module.exports = { buildGroupAnalyticsFilter };
