async function hasGroupMembership(executor, groupId, account) {
  const [rows] = await executor.execute(
    `SELECT g.id FROM \`groups\` g
     JOIN group_members gm ON gm.group_id = g.id AND gm.person_id = ?
     WHERE g.id = ? AND g.workspace_id = ?`,
    [account.person_id, groupId, account.workspace_id]
  );
  return rows.length > 0;
}

async function hasAccountGroupMembership(executor, groupId, accountId) {
  const [rows] = await executor.execute(
    `SELECT 1 FROM group_accounts
     WHERE group_id = ? AND account_id = ? LIMIT 1`,
    [groupId, accountId]
  );
  return rows.length > 0;
}

async function hasGroupAdministrationAccess(executor, groupId, accountId) {
  const [rows] = await executor.execute(
    `SELECT 1 FROM \`groups\` g
     LEFT JOIN group_accounts ga ON ga.group_id = g.id AND ga.account_id = ?
     WHERE g.id = ? AND (g.owner_account_id = ? OR ga.role = 'admin')
     LIMIT 1`,
    [accountId, groupId, accountId]
  );
  return rows.length > 0;
}

module.exports = { hasGroupMembership, hasAccountGroupMembership, hasGroupAdministrationAccess };
