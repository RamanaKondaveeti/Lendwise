function isValidReportDate(value) {
  if (!value) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function buildExpenseReportFilter({ workspaceId, groupId, memberId, category, startDate, endDate }) {
  if (!Number.isInteger(Number(workspaceId)) || Number(workspaceId) <= 0 ||
      (groupId !== null && (!Number.isInteger(Number(groupId)) || Number(groupId) <= 0)) ||
      (memberId !== null && (!Number.isInteger(Number(memberId)) || Number(memberId) <= 0)) ||
      (category !== null && (typeof category !== 'string' || !category || category.length > 100)) ||
      !isValidReportDate(startDate) || !isValidReportDate(endDate) ||
      (startDate && endDate && startDate > endDate)) {
    throw new TypeError('Invalid report filters.');
  }
  const conditions = ['g.workspace_id = ?'];
  const parameters = [Number(workspaceId)];
  if (groupId !== null) {
    conditions.push('e.group_id = ?');
    parameters.push(Number(groupId));
  }
  if (category !== null) {
    conditions.push('e.category = ?');
    parameters.push(category);
  }
  if (startDate) {
    conditions.push('e.created_at >= ?');
    parameters.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    conditions.push('e.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    parameters.push(endDate);
  }
  if (memberId !== null) {
    conditions.push('(e.paid_by = ? OR EXISTS (SELECT 1 FROM splits member_split WHERE member_split.expense_id = e.id AND member_split.person_id = ?))');
    parameters.push(Number(memberId), Number(memberId));
  }
  return { where: conditions.join(' AND '), parameters };
}

function buildSettlementReportFilter({ workspaceId, groupId, memberId, startDate, endDate }) {
  if (!Number.isInteger(Number(workspaceId)) || Number(workspaceId) <= 0 ||
      (groupId !== null && (!Number.isInteger(Number(groupId)) || Number(groupId) <= 0)) ||
      (memberId !== null && (!Number.isInteger(Number(memberId)) || Number(memberId) <= 0)) ||
      !isValidReportDate(startDate) || !isValidReportDate(endDate) ||
      (startDate && endDate && startDate > endDate)) {
    throw new TypeError('Invalid report filters.');
  }
  const conditions = ['payer.workspace_id = ?', 'payee.workspace_id = ?'];
  const parameters = [Number(workspaceId), Number(workspaceId)];
  if (groupId !== null) {
    conditions.push('COALESCE(st.group_id, linked_group.id) = ?');
    parameters.push(Number(groupId));
  }
  if (memberId !== null) {
    conditions.push('(st.payer_id = ? OR st.payee_id = ?)');
    parameters.push(Number(memberId), Number(memberId));
  }
  if (startDate) {
    conditions.push('st.created_at >= ?');
    parameters.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    conditions.push('st.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    parameters.push(endDate);
  }
  return { where: conditions.join(' AND '), parameters };
}

module.exports = {
  buildExpenseReportFilter,
  buildSettlementReportFilter,
  isValidReportDate,
};
