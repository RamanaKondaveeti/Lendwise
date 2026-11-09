-- Back up the source database and stop the app before running this migration.
-- If the configured source database is not `lendwise`, replace that identifier
-- below with the actual source database name before execution.
-- This moves existing tables; it does not drop the source database or its other objects.
CREATE DATABASE IF NOT EXISTS `groupbuk`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

RENAME TABLE
  `lendwise`.`workspaces` TO `groupbuk`.`groupbuk_workspaces`,
  `lendwise`.`people` TO `groupbuk`.`groupbuk_people`,
  `lendwise`.`accounts` TO `groupbuk`.`groupbuk_accounts`,
  `lendwise`.`auth_sessions` TO `groupbuk`.`groupbuk_auth_sessions`,
  `lendwise`.`workspace_members` TO `groupbuk`.`groupbuk_workspace_members`,
  `lendwise`.`email_tokens` TO `groupbuk`.`groupbuk_email_tokens`,
  `lendwise`.`groups` TO `groupbuk`.`groupbuk_groups`,
  `lendwise`.`group_members` TO `groupbuk`.`groupbuk_group_members`,
  `lendwise`.`expenses` TO `groupbuk`.`groupbuk_expenses`,
  `lendwise`.`splits` TO `groupbuk`.`groupbuk_splits`,
  `lendwise`.`settlements` TO `groupbuk`.`groupbuk_settlements`,
  `lendwise`.`workspace_invitations` TO `groupbuk`.`groupbuk_workspace_invitations`;
