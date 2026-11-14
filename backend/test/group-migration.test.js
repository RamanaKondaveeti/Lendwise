const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../db/migrations/002_group_account_architecture.sql'),
  'utf8'
);

test('Phase C migration is additive and retains legacy workspace structures', () => {
  assert.match(migration, /CREATE TABLE group_accounts/);
  assert.match(migration, /CREATE TABLE group_invitations/);
  assert.match(migration, /CREATE TABLE settlement_history_participants/);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+(workspace_invitations|settlements|expenses)/i);
  assert.match(migration, /UPDATE `groups` SET owner_account_id = NULL, ownership_status = 'needs_assignment'/);
});

test('new group memberships and invitations are account/group scoped', () => {
  const groupAccounts = migration.match(/CREATE TABLE group_accounts \(([\s\S]*?)\);/i)?.[1] || '';
  const groupInvitations = migration.match(/CREATE TABLE group_invitations \(([\s\S]*?)\);/i)?.[1] || '';
  assert.match(groupAccounts, /group_id INT NOT NULL/);
  assert.match(groupAccounts, /account_id INT NOT NULL/);
  assert.doesNotMatch(groupAccounts, /workspace_id/);
  assert.match(groupInvitations, /group_id INT NOT NULL/);
  assert.match(groupInvitations, /invited_by_account_id INT NOT NULL/);
  assert.match(groupInvitations, /token_hash CHAR\(64\) NOT NULL UNIQUE/);
  assert.doesNotMatch(groupInvitations, /workspace_id/);
});

test('legacy invitation token hashes are revoked and invalidated without rewriting status', () => {
  assert.match(migration, /revoked_token_hash = COALESCE\(revoked_token_hash, token_hash\)/);
  assert.match(migration, /token_hash = SHA2\(CONCAT\(token_hash/);
  assert.match(migration, /legacy_disabled_at = UTC_TIMESTAMP\(\)/);
  assert.doesNotMatch(migration, /UPDATE workspace_invitations[\s\S]*accepted_at\s*=/i);
  assert.doesNotMatch(migration, /UPDATE workspace_invitations[\s\S]*cancelled_at\s*=/i);
});

test('historical settlement access migration selects only original payer/payee links for unassigned records', () => {
  assert.match(migration, /payer_id AS person_id/);
  assert.match(migration, /payee_id AS person_id/);
  assert.match(migration, /WHERE st\.group_id IS NULL/);
  assert.match(migration, /st\.expense_id IS NULL OR e\.id IS NULL OR e\.group_id IS NULL/);
});
