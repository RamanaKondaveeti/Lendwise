async function hasGroupMembership(executor, groupId, account) {
  const [rows] = await executor.execute(
    `SELECT g.id FROM \`groups\` g
     JOIN group_members gm ON gm.group_id = g.id AND gm.person_id = ?
     WHERE g.id = ? AND g.workspace_id = ?`,
    [account.person_id, groupId, account.workspace_id]
  );
  return rows.length > 0;
}

module.exports = { hasGroupMembership };
