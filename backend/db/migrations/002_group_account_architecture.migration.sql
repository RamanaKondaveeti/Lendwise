-- Phase C additive architecture foundation.
-- Run once, manually, against an isolated development/test database only.
-- Do not run from application startup or against production.
-- Keep all legacy workspace columns/tables and existing person memberships.

CREATE TABLE group_accounts (
  group_id INT NOT NULL,
  account_id INT NOT NULL,
  role ENUM('member', 'admin') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, account_id),
  INDEX idx_group_accounts_account (account_id, group_id),
  CONSTRAINT fk_group_accounts_group FOREIGN KEY (group_id) REFERENCES `groups`(id),
  CONSTRAINT fk_group_accounts_account FOREIGN KEY (account_id) REFERENCES accounts(id)
);

ALTER TABLE `groups`
  ADD COLUMN owner_account_id INT NULL,
  ADD COLUMN ownership_status ENUM('assigned', 'needs_assignment') NOT NULL DEFAULT 'needs_assignment',
  ADD INDEX idx_groups_owner_account (owner_account_id),
  ADD CONSTRAINT fk_groups_owner_account FOREIGN KEY (owner_account_id) REFERENCES accounts(id);

-- Transfer only explicit person-to-account links; guest-only group_members rows remain intact.
INSERT INTO group_accounts (group_id, account_id, role, joined_at)
SELECT DISTINCT gm.group_id, wm.account_id, 'member', gm.created_at
FROM group_members gm
JOIN `groups` g ON g.id = gm.group_id
JOIN people p ON p.id = gm.person_id
JOIN workspace_members wm ON wm.person_id = p.id AND wm.workspace_id = g.workspace_id
JOIN accounts a ON a.id = wm.account_id
ON DUPLICATE KEY UPDATE joined_at = LEAST(group_accounts.joined_at, VALUES(joined_at));

-- Historical owners are intentionally not inferred. Every migrated group remains unassigned.
UPDATE `groups` SET owner_account_id = NULL, ownership_status = 'needs_assignment';

CREATE TABLE group_invitations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  invited_by_account_id INT NOT NULL,
  invitee_account_id INT NULL,
  email VARCHAR(254) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  revoked_token_hash CHAR(64) NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_group_invitations_group FOREIGN KEY (group_id) REFERENCES `groups`(id),
  CONSTRAINT fk_group_invitations_sender FOREIGN KEY (invited_by_account_id) REFERENCES accounts(id),
  CONSTRAINT fk_group_invitations_invitee FOREIGN KEY (invitee_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  INDEX idx_group_invitations_email (group_id, email),
  INDEX idx_group_invitations_expiration (expires_at)
);

-- Dedicated read-only access index for unresolved historical settlements.
-- Access is limited to accounts explicitly linked to the original payer/payee people.
CREATE TABLE settlement_history_participants (
  settlement_id INT NOT NULL,
  account_id INT NOT NULL,
  participant_person_id INT NOT NULL,
  PRIMARY KEY (settlement_id, account_id),
  CONSTRAINT fk_settlement_history_settlement FOREIGN KEY (settlement_id) REFERENCES settlements(id),
  CONSTRAINT fk_settlement_history_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_settlement_history_person FOREIGN KEY (participant_person_id) REFERENCES people(id),
  INDEX idx_settlement_history_account (account_id, settlement_id)
);

INSERT IGNORE INTO settlement_history_participants (settlement_id, account_id, participant_person_id)
SELECT st.id, wm.account_id, person_link.person_id
FROM settlements st
JOIN (
  SELECT id AS settlement_id, payer_id AS person_id FROM settlements
  UNION
  SELECT id AS settlement_id, payee_id AS person_id FROM settlements
) person_link ON person_link.settlement_id = st.id
JOIN workspace_members wm ON wm.person_id = person_link.person_id
LEFT JOIN expenses e ON e.id = st.expense_id
WHERE st.group_id IS NULL
  AND (st.expense_id IS NULL OR e.id IS NULL OR e.group_id IS NULL);

-- Mark and invalidate every legacy workspace invitation without changing its audit status.
ALTER TABLE workspace_invitations ADD COLUMN legacy_disabled_at DATETIME NULL;
UPDATE workspace_invitations
SET revoked_token_hash = COALESCE(revoked_token_hash, token_hash),
    token_hash = SHA2(CONCAT(token_hash, ':legacy-disabled:', id, ':', UUID()), 256),
    legacy_disabled_at = UTC_TIMESTAMP();
