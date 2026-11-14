-- Track B additive account identity/session compatibility changes.
-- Run only after 002_group_account_architecture on an isolated development/test database.
-- No legacy records are removed or reassigned. Workspace-scoped records stay nullable only
-- where the account/group architecture can operate without a workspace.

ALTER TABLE people MODIFY workspace_id INT NULL;
ALTER TABLE accounts MODIFY workspace_id INT NULL;
ALTER TABLE auth_sessions MODIFY workspace_id INT NULL;
ALTER TABLE `groups` MODIFY workspace_id INT NULL;
