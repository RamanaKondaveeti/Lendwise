CREATE TABLE IF NOT EXISTS workspaces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS people (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  initials VARCHAR(16) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#dcebdd',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_people_workspace (workspace_id),
  CONSTRAINT fk_people_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  person_id INT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_accounts_workspace (workspace_id),
  CONSTRAINT fk_accounts_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_accounts_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  account_id INT NOT NULL,
  workspace_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auth_sessions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_auth_sessions_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  INDEX idx_auth_sessions_expiration (expires_at)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  account_id INT PRIMARY KEY,
  expense_created TINYINT(1) NOT NULL DEFAULT 1,
  expense_updated TINYINT(1) NOT NULL DEFAULT 1,
  settlement_recorded TINYINT(1) NOT NULL DEFAULT 1,
  settlement_reminder TINYINT(1) NOT NULL DEFAULT 1,
  group_invitation TINYINT(1) NOT NULL DEFAULT 1,
  member_joined TINYINT(1) NOT NULL DEFAULT 1,
  recurring_generated TINYINT(1) NOT NULL DEFAULT 1,
  recurring_confirmation TINYINT(1) NOT NULL DEFAULT 1,
  budget_alert TINYINT(1) NOT NULL DEFAULT 1,
  settlement_reminder_frequency ENUM('off', 'daily', 'weekly') NOT NULL DEFAULT 'weekly',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_preferences_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  workspace_id INT NOT NULL,
  notification_type ENUM(
    'expense_created', 'expense_updated', 'settlement_recorded',
    'settlement_reminder', 'group_invitation', 'member_joined',
    'recurring_generated', 'recurring_confirmation', 'budget_alert'
  ) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(500) NOT NULL,
  target_type ENUM('expense', 'group', 'settlement', 'recurring', 'invitation', 'workspace', 'budget') NOT NULL,
  target_id INT NULL,
  target_date DATE NULL,
  dedupe_key VARCHAR(190) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  CONSTRAINT fk_notifications_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE KEY uq_notification_account_dedupe (account_id, dedupe_key),
  INDEX idx_notifications_unread (account_id, read_at, created_at)
);

CREATE TABLE IF NOT EXISTS workspace_members (
  account_id INT NOT NULL,
  workspace_id INT NOT NULL,
  person_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, workspace_id),
  UNIQUE KEY uq_workspace_members_person (workspace_id, person_id),
  CONSTRAINT fk_workspace_members_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_members_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_members_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  account_id INT NOT NULL,
  token_type ENUM('password_reset') NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_email_tokens_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  INDEX idx_email_tokens_account_type (account_id, token_type),
  INDEX idx_email_tokens_expiration (expires_at)
);

CREATE TABLE IF NOT EXISTS `groups` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  icon VARCHAR(64) NOT NULL DEFAULT 'users',
  color VARCHAR(16) NOT NULL DEFAULT '#dcebdd',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_groups_workspace (workspace_id),
  CONSTRAINT fk_groups_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INT NOT NULL,
  person_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, person_id),
  CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_group_members_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS budgets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  created_by INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  budget_type ENUM('personal', 'group') NOT NULL,
  person_id INT NULL,
  group_id INT NULL,
  category VARCHAR(100) NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  currency ENUM('INR', 'USD') NOT NULL DEFAULT 'INR',
  exchange_rate_to_inr DECIMAL(15, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate_to_inr > 0),
  period ENUM('weekly', 'monthly', 'yearly') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  alert_thresholds JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_budgets_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_budgets_creator FOREIGN KEY (created_by) REFERENCES people(id),
  CONSTRAINT fk_budgets_person FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE,
  CONSTRAINT fk_budgets_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  INDEX idx_budgets_owner (workspace_id, person_id, is_active),
  INDEX idx_budgets_group (workspace_id, group_id, is_active)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  paid_by INT NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Other',
  split_method ENUM('equal', 'exact', 'percentage', 'shares', 'itemwise') NOT NULL DEFAULT 'equal',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_expenses_payer FOREIGN KEY (paid_by) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS splits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_id INT NOT NULL,
  person_id INT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
  CONSTRAINT fk_splits_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_splits_person FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS expense_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_id INT NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  quantity DECIMAL(10, 3) NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(12, 2) NOT NULL CHECK (unit_price >= 0),
  total_amount DECIMAL(12, 2) NOT NULL CHECK (total_amount >= 0),
  allocation_method ENUM('equal', 'exact', 'percentage', 'shares') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_items_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  INDEX idx_expense_items_expense (expense_id)
);

CREATE TABLE IF NOT EXISTS expense_item_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expense_item_id INT NOT NULL,
  person_id INT NOT NULL,
  allocation_amount DECIMAL(12, 2) NOT NULL CHECK (allocation_amount >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_item_allocations_item FOREIGN KEY (expense_item_id) REFERENCES expense_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_expense_item_allocations_person FOREIGN KEY (person_id) REFERENCES people(id),
  INDEX idx_expense_item_allocations_item (expense_item_id),
  INDEX idx_expense_item_allocations_person (person_id)
);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  group_id INT NOT NULL,
  created_by INT NOT NULL,
  paid_by INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  base_amount DECIMAL(12, 2) NOT NULL CHECK (base_amount > 0),
  currency ENUM('INR', 'USD') NOT NULL,
  exchange_rate_to_inr DECIMAL(15, 8) NOT NULL CHECK (exchange_rate_to_inr > 0),
  category VARCHAR(100) NOT NULL DEFAULT 'Other',
  split_method ENUM('equal', 'custom') NOT NULL DEFAULT 'equal',
  variable_amount BOOLEAN NOT NULL DEFAULT FALSE,
  frequency ENUM('weekly', 'monthly', 'quarterly', 'yearly') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  anchor_month TINYINT UNSIGNED NOT NULL,
  anchor_day TINYINT UNSIGNED NOT NULL,
  next_occurrence_date DATE NULL,
  status ENUM('active', 'paused', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_recurring_expenses_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_recurring_expenses_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_recurring_expenses_creator FOREIGN KEY (created_by) REFERENCES people(id),
  CONSTRAINT fk_recurring_expenses_payer FOREIGN KEY (paid_by) REFERENCES people(id),
  INDEX idx_recurring_due (status, next_occurrence_date)
);

CREATE TABLE IF NOT EXISTS recurring_expense_participants (
  template_id INT NOT NULL,
  person_id INT NOT NULL,
  share_percent DECIMAL(7, 4) NULL,
  PRIMARY KEY (template_id, person_id),
  CONSTRAINT fk_recurring_participants_template FOREIGN KEY (template_id) REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_recurring_participants_person FOREIGN KEY (person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS recurring_expense_occurrences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  occurrence_date DATE NOT NULL,
  status ENUM('processing', 'needs_confirmation', 'generated') NOT NULL DEFAULT 'processing',
  expense_id INT NULL,
  entered_amount DECIMAL(12, 2) NULL,
  base_amount DECIMAL(12, 2) NULL,
  generated_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recurring_occurrences_template FOREIGN KEY (template_id) REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_recurring_occurrences_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
  UNIQUE KEY uq_recurring_occurrence (template_id, occurrence_date),
  INDEX idx_recurring_occurrence_date (occurrence_date)
);

CREATE TABLE IF NOT EXISTS settlements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payer_id INT NOT NULL,
  payee_id INT NOT NULL,
  expense_id INT NULL,
  group_id INT NULL,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  note VARCHAR(255) NOT NULL DEFAULT 'Settlement',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_settlements_payer FOREIGN KEY (payer_id) REFERENCES people(id),
  CONSTRAINT fk_settlements_payee FOREIGN KEY (payee_id) REFERENCES people(id),
  CONSTRAINT fk_settlements_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  CONSTRAINT fk_settlements_group FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  INDEX idx_settlements_expense (expense_id),
  INDEX idx_settlements_group (group_id)
);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  invitee_account_id INT NULL,
  email VARCHAR(254) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by INT NOT NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_workspace_invitations_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_invitations_account FOREIGN KEY (invited_by) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_workspace_invitations_invitee FOREIGN KEY (invitee_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  INDEX idx_workspace_invitations_email (email),
  INDEX idx_workspace_invitations_expiration (expires_at)
);
