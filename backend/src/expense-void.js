function expenseVoidRejection({ isGroupMember, alreadyVoided, hasLinkedSettlements }) {
  if (!isGroupMember) {
    return { status: 403, error: 'Only a member of this group can void its expenses.' };
  }
  if (alreadyVoided) {
    return { status: 409, error: 'This expense has already been voided.' };
  }
  if (hasLinkedSettlements) {
    return {
      status: 409,
      error: 'This expense has recorded payments and cannot be voided. Keep it in the ledger so its settlement history and balances remain accurate.',
    };
  }
  return null;
}

module.exports = { expenseVoidRejection };
