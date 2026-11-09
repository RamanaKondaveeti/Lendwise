CREATE TABLE IF NOT EXISTS groupbuk_workspaces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS groupbuk_people (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  initials VARCHAR(16) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#dcebdd',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_people_workspace (workspace_id),
  CONSTRAINT fk_people_workspace FOREIGN KEY (workspace_id) REFERENCES groupbuk_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS groupbuk_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  person_id INT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_accounts_workspace (workspace_id),
  CONSTRAINT fk_accounts_workspace FOREIGN KEY (workspace_id) REFERENCES groupbuk_workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_accounts_person FOREIGN KEY (person_id) REFERENCES groupbuk_people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS groupbuk_auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  account_id INT NOT NULL,
  workspace_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auth_sessions_account FOREIGN KEY (account_id) REFERENCES groupbuk_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_auth_sessions_workspace FOREIGN KEY (workspace_id) REFERENCES groupbuk_workspaces(id) ON DELETE CASCADE,
  INDEX idx_auth_sessions_expiration (expires_at)
);

CREATE TABLE IF NOT EXISTS groupbuk_workspace_members (
  account_id INT NOT NULL,
  workspace_id INT NOT NULL,
  person_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, workspace_id),
  UNIQUE KEY uq_workspace_members_person (workspace_id, person_id),
  CONSTRAINT fk_workspace_members_account FOREIGN KEY (account_id) REFERENCES groupbuk_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_members_workspace FOREIGN KEY (workspace_id) REFERENCES groupbuk_workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_members_person FOREIGN KEY (person_id) REFERENCES groupbuk_people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS groupbuk_email_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  account_id INT NOT NULL,
  token_type ENUM('password_reset') NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_email_tokens_account FOREIGN KEY (account_id) REFERENCES groupbuk_accounts(id) ON DELETE CASCADE,
  INDEX idx_email_tokens_account_type (account_id, token_type),
  INDEX idx_email_tokens_expiration (expires_at)
);

CREATE TABLE IF NOT EXISTS groupbuk_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  icon VARCHAR(64) NOT NULL DEFAULT 'users',
  color VARCHAR(16) NOT NULL DEFAULT '#dcebdd',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_groups_workspace (workspace_id),
  CONSTRAINT fk_groups_workspace FOREIGN KEY (workspace_id) REFERENCES groupbuk_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS groupbuk_group_members (
  group_id INT NOT NULL,
  person_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, person_id),
  CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES groupbuk_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_group_members_person FOREIGN KEY (person_id) REFERENCES groupbuk_people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS groupbuk_expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  paid_by INT NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Other',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_group FOREIGN KEY (group_id) REFERENCES groupbuk_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_expenses_payer FOREIGN KEY (paid_by) REFERENCES groupbuk_people(id)
);

CREATE TABLE IF NOT EXISTS groupbuk_splits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_id INT NOT NULL,
  person_id INT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
  CONSTRAINT fk_splits_expense FOREIGN KEY (expense_id) REFERENCES groupbuk_expenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_splits_person FOREIGN KEY (person_id) REFERENCES groupbuk_people(id)
);

CREATE TABLE IF NOT EXISTS groupbuk_settlements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payer_id INT NOT NULL,
  payee_id INT NOT NULL,
  expense_id INT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  note VARCHAR(255) NOT NULL DEFAULT 'Settlement',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_settlements_payer FOREIGN KEY (payer_id) REFERENCES groupbuk_people(id),
  CONSTRAINT fk_settlements_payee FOREIGN KEY (payee_id) REFERENCES groupbuk_people(id),
  CONSTRAINT fk_settlements_expense FOREIGN KEY (expense_id) REFERENCES groupbuk_expenses(id) ON DELETE CASCADE,
  INDEX idx_settlements_expense (expense_id)
);

CREATE TABLE IF NOT EXISTS groupbuk_workspace_invitations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  invitee_account_id INT NULL,
  email VARCHAR(254) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by INT NOT NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_workspace_invitations_workspace FOREIGN KEY (workspace_id) REFERENCES groupbuk_workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_invitations_account FOREIGN KEY (invited_by) REFERENCES groupbuk_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_invitations_invitee FOREIGN KEY (invitee_account_id) REFERENCES groupbuk_accounts(id) ON DELETE CASCADE,
  INDEX idx_workspace_invitations_email (email),
  INDEX idx_workspace_invitations_expiration (expires_at)
);

CREATE OR REPLACE VIEW workspaces AS SELECT * FROM groupbuk_workspaces;
CREATE OR REPLACE VIEW people AS SELECT * FROM groupbuk_people;
CREATE OR REPLACE VIEW accounts AS SELECT * FROM groupbuk_accounts;
CREATE OR REPLACE VIEW auth_sessions AS SELECT * FROM groupbuk_auth_sessions;
CREATE OR REPLACE VIEW workspace_members AS SELECT * FROM groupbuk_workspace_members;
CREATE OR REPLACE VIEW email_tokens AS SELECT * FROM groupbuk_email_tokens;
CREATE OR REPLACE VIEW `groups` AS SELECT * FROM groupbuk_groups;
CREATE OR REPLACE VIEW group_members AS SELECT * FROM groupbuk_group_members;
CREATE OR REPLACE VIEW expenses AS SELECT * FROM groupbuk_expenses;
CREATE OR REPLACE VIEW splits AS SELECT * FROM groupbuk_splits;
CREATE OR REPLACE VIEW settlements AS SELECT * FROM groupbuk_settlements;
CREATE OR REPLACE VIEW workspace_invitations AS SELECT * FROM groupbuk_workspace_invitations;
