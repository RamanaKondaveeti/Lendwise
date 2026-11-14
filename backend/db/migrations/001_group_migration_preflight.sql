-- READ ONLY. Run only against a restored test database, never as an application migration.
-- Capture all result sets with the backup ID before planning any writes.

-- 1. Current account, workspace, and group inventory.
SELECT
  (SELECT COUNT(*) FROM workspaces) AS workspace_count,
  (SELECT COUNT(*) FROM accounts) AS account_count,
  (SELECT COUNT(*) FROM people) AS people_count,
  (SELECT COUNT(*) FROM `groups`) AS group_count,
  (SELECT COUNT(*) FROM group_members) AS group_membership_count,
  (SELECT COUNT(*) FROM workspace_invitations) AS invitation_count;

-- 2. Accounts with memberships in multiple workspaces. These may have multiple person rows.
SELECT wm.account_id, COUNT(*) AS workspace_membership_count,
       GROUP_CONCAT(wm.workspace_id ORDER BY wm.workspace_id) AS workspace_ids,
       GROUP_CONCAT(wm.person_id ORDER BY wm.workspace_id) AS person_ids
FROM workspace_members wm
GROUP BY wm.account_id
HAVING COUNT(*) > 1
ORDER BY wm.account_id;

-- 3. Account/person links and unregistered people used by groups or financial history.
SELECT a.id AS account_id, a.person_id AS account_person_id,
       COUNT(DISTINCT wm.person_id) AS workspace_person_count,
       GROUP_CONCAT(DISTINCT wm.person_id ORDER BY wm.person_id) AS workspace_person_ids
FROM accounts a
LEFT JOIN workspace_members wm ON wm.account_id = a.id
GROUP BY a.id, a.person_id
HAVING COUNT(DISTINCT wm.person_id) <> 1
    OR MAX(wm.person_id <> a.person_id) = 1
ORDER BY a.id;

SELECT p.id AS person_id, p.workspace_id, p.name,
       EXISTS(SELECT 1 FROM group_members gm WHERE gm.person_id = p.id) AS has_group_membership,
       EXISTS(SELECT 1 FROM expenses e WHERE e.paid_by = p.id) AS has_paid_expense,
       EXISTS(SELECT 1 FROM splits s WHERE s.person_id = p.id) AS has_expense_split,
       EXISTS(SELECT 1 FROM settlements st WHERE st.payer_id = p.id OR st.payee_id = p.id OR st.created_by = p.id) AS has_settlement_history
FROM people p
LEFT JOIN accounts a ON a.person_id = p.id
WHERE a.id IS NULL
ORDER BY p.workspace_id, p.id;

-- 4. Cross-workspace group memberships, which must be reviewed before workspace scope is removed.
SELECT gm.group_id, g.workspace_id AS group_workspace_id,
       gm.person_id, p.workspace_id AS person_workspace_id
FROM group_members gm
JOIN `groups` g ON g.id = gm.group_id
JOIN people p ON p.id = gm.person_id
WHERE g.workspace_id <> p.workspace_id
ORDER BY gm.group_id, gm.person_id;

-- 5. Group roster inventory only. Membership order is not creator/ownership evidence.
SELECT g.id AS group_id, g.workspace_id, g.name, g.created_at,
       COUNT(gm.person_id) AS member_count,
       MIN(gm.created_at) AS first_membership_at,
       SUM(a.id IS NOT NULL) AS account_member_count
FROM `groups` g
LEFT JOIN group_members gm ON gm.group_id = g.id
LEFT JOIN workspace_members wm ON wm.person_id = gm.person_id AND wm.workspace_id = g.workspace_id
LEFT JOIN accounts a ON a.id = wm.account_id
GROUP BY g.id, g.workspace_id, g.name, g.created_at
ORDER BY g.workspace_id, g.id;

-- Inspect available creator/owner evidence without assuming any column exists.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('groups', 'group_activity')
  AND LOWER(COLUMN_NAME) REGEXP 'creator|created_by|owner|admin|actor|activity_type'
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 6. Pending workspace invitations and possible inviter group scopes.
-- More than one candidate means a group cannot safely be inferred from the old invitation.
SELECT i.id AS invitation_id, i.workspace_id, i.invited_by, i.email,
       i.created_at, i.expires_at,
       COUNT(DISTINCT g.id) AS inviter_group_count,
       GROUP_CONCAT(DISTINCT CONCAT(g.id, ':', g.name) ORDER BY g.id) AS inviter_groups
FROM workspace_invitations i
LEFT JOIN workspace_members wm
  ON wm.account_id = i.invited_by AND wm.workspace_id = i.workspace_id
LEFT JOIN group_members gm ON gm.person_id = wm.person_id
LEFT JOIN `groups` g ON g.id = gm.group_id AND g.workspace_id = i.workspace_id
WHERE i.accepted_at IS NULL AND i.cancelled_at IS NULL AND i.expires_at > UTC_TIMESTAMP()
GROUP BY i.id, i.workspace_id, i.invited_by, i.email, i.created_at, i.expires_at
ORDER BY i.workspace_id, i.id;

-- 7. Settlements lacking explicit group associations.
-- A linked expense's group is safe only when the expense link resolves and is consistent.
-- Shared group membership is review context only, never an automatic mapping rule.
SELECT st.id AS settlement_id, st.payer_id, st.payee_id, st.expense_id, st.group_id,
       st.amount, st.created_at,
       e.group_id AS expense_group_candidate,
       CASE
         WHEN st.expense_id IS NOT NULL AND e.id IS NOT NULL AND e.group_id IS NOT NULL
           THEN 'safe_from_linked_expense_after_consistency_check'
         WHEN st.expense_id IS NOT NULL THEN 'unresolved_missing_or_invalid_expense_link'
         WHEN COUNT(DISTINCT common_group.group_id) = 1 THEN 'unresolved_single_shared_group_candidate_review_only'
         WHEN COUNT(DISTINCT common_group.group_id) > 1 THEN 'unresolved_ambiguous_shared_groups'
         ELSE 'unresolved_no_shared_group_candidate'
       END AS mapping_classification,
       COUNT(DISTINCT common_group.group_id) AS common_group_candidate_count,
       GROUP_CONCAT(DISTINCT CONCAT(common_group.group_id, ':', common_group.name)
                    ORDER BY common_group.group_id) AS common_groups
FROM settlements st
LEFT JOIN expenses e ON e.id = st.expense_id
LEFT JOIN (
  SELECT payer_membership.person_id AS payer_id,
         payee_membership.person_id AS payee_id,
         payer_membership.group_id,
         g.name
  FROM group_members payer_membership
  JOIN group_members payee_membership
    ON payee_membership.group_id = payer_membership.group_id
  JOIN `groups` g ON g.id = payer_membership.group_id
) common_group
  ON common_group.payer_id = st.payer_id AND common_group.payee_id = st.payee_id
WHERE st.group_id IS NULL
GROUP BY st.id, st.payer_id, st.payee_id, st.expense_id, st.group_id,
         st.amount, st.created_at, e.group_id
ORDER BY st.id;

-- Counts for settlement triage. These are estimates for review, not write instructions.
SELECT
  SUM(st.group_id IS NOT NULL) AS explicitly_group_associated_count,
  SUM(st.group_id IS NULL AND st.expense_id IS NOT NULL AND e.id IS NOT NULL AND e.group_id IS NOT NULL)
    AS linked_expense_mapping_candidate_count,
  SUM(st.group_id IS NULL AND NOT (st.expense_id IS NOT NULL AND e.id IS NOT NULL AND e.group_id IS NOT NULL))
    AS unresolved_group_mapping_count
FROM settlements st
LEFT JOIN expenses e ON e.id = st.expense_id;

-- 8. Expense splits and recurring participants that are not current members of the owning group.
SELECT e.id AS expense_id, e.group_id, s.person_id
FROM expenses e
JOIN splits s ON s.expense_id = e.id
LEFT JOIN group_members gm ON gm.group_id = e.group_id AND gm.person_id = s.person_id
WHERE gm.person_id IS NULL
ORDER BY e.group_id, e.id, s.person_id;

SELECT r.id AS recurring_template_id, r.group_id, rp.person_id
FROM recurring_expenses r
JOIN recurring_expense_participants rp ON rp.template_id = r.id
LEFT JOIN group_members gm ON gm.group_id = r.group_id AND gm.person_id = rp.person_id
WHERE gm.person_id IS NULL
ORDER BY r.group_id, r.id, rp.person_id;

-- 9. Financial baselines. Compare these values before/after migration without rewriting amounts.
SELECT g.workspace_id, e.group_id,
       COUNT(*) AS expense_count,
       SUM(e.amount) AS expense_amount,
       SUM(e.voided_at IS NOT NULL) AS voided_expense_count
FROM expenses e
JOIN `groups` g ON g.id = e.group_id
GROUP BY g.workspace_id, e.group_id
ORDER BY g.workspace_id, e.group_id;

SELECT g.workspace_id, e.group_id,
       COUNT(*) AS split_count,
       SUM(s.amount) AS split_amount
FROM splits s
JOIN expenses e ON e.id = s.expense_id
JOIN `groups` g ON g.id = e.group_id
GROUP BY g.workspace_id, e.group_id
ORDER BY g.workspace_id, e.group_id;

SELECT COALESCE(group_id, -1) AS group_id_or_unassigned,
       COUNT(*) AS settlement_count,
       SUM(amount) AS settlement_amount
FROM settlements
GROUP BY group_id
ORDER BY group_id;

SELECT 'budgets' AS record_type, COUNT(*) AS record_count, COALESCE(SUM(amount), 0) AS amount_total FROM budgets
UNION ALL
SELECT 'recurring_expenses', COUNT(*), COALESCE(SUM(amount), 0) FROM recurring_expenses
UNION ALL
SELECT 'expense_items', COUNT(*), COALESCE(SUM(total_amount), 0) FROM expense_items
UNION ALL
SELECT 'expense_item_allocations', COUNT(*), COALESCE(SUM(allocation_amount), 0) FROM expense_item_allocations;

-- 10. Idempotency keys that would collide if workspace_id were removed from their unique key.
SELECT account_id, operation, key_hash, COUNT(*) AS duplicate_count,
       GROUP_CONCAT(workspace_id ORDER BY workspace_id) AS workspace_ids
FROM idempotency_requests
GROUP BY account_id, operation, key_hash
HAVING COUNT(*) > 1
ORDER BY account_id, operation, key_hash;

-- 11. Other durable record counts to compare after migration.
SELECT
  (SELECT COUNT(*) FROM group_activity) AS group_activity_count,
  (SELECT COUNT(*) FROM notifications) AS notification_count,
  (SELECT COUNT(*) FROM notification_preferences) AS notification_preference_count,
  (SELECT COUNT(*) FROM recurring_expense_occurrences) AS recurring_occurrence_count,
  (SELECT COUNT(*) FROM workspace_invitations) AS invitation_history_count;
