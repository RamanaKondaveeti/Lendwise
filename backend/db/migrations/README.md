# Group based migration design

This directory contains the Phase B design, a read-only preflight, and the additive Phase C schema foundation. Do not point migration experiments at production.

## Phase B policy decisions

- **Legacy workspace invitations:** preserve every record and its status as audit history. Do not convert invitations into invitations to each group, and do not create group membership from an invitation. Before cutover, invalidate legacy workspace tokens while retaining the audit record; preserve the existing token-hash revocation mechanism or add an explicit legacy-disabled marker in a later migration. Group acceptance must recognize only new group-scoped invitation records. Pending recipients must be told to ignore the old link and ask the original sender or an authorized member of the intended group to send a new group invitation.
- **Group ownership:** map an owner only from reliable historical creator evidence tied to that group. Do not infer ownership from earliest membership, expense payer/activity, account ordering, or current membership. Groups without reliable evidence remain owner-unassigned and require an explicit, auditable resolution; do not silently choose an owner.
- **Settlements:** retain explicit `group_id` associations. A null `group_id` may be filled from a valid, consistent `expense_id -> expenses.group_id` relation after validation. Shared membership, even a single shared group, is only a manual review clue and never sufficient for automatic mapping. Keep unresolved settlements as unassigned historical records, preserving identifiers, participants, amounts, timestamps, and notes.

## Preflight

`001_group_migration_preflight.sql` is read-only and intended only for a restored test database. It inventories account/person identity mappings, group rosters and creator-field metadata, pending workspace invitations, settlement mapping evidence, orphaned membership references, and financial/history baselines. The roster query deliberately does not nominate an owner. A linked-expense settlement count is a candidate count that still requires consistency checks.

Save all result sets together with the restored backup identifier. No restored test database was available for this design pass, so unresolved row counts are **not yet known**. Do not substitute production data. Run the preflight on the restored copy before finalizing mapping counts or approving a write plan.

See [PHASE_B_DESIGN.md](PHASE_B_DESIGN.md) for evidence, sequence, rollback, and outstanding decisions.

## Phase C foundation status

`002_group_account_architecture.migration.sql` is a one-time additive migration for isolated development/test databases. It adds direct account-to-group membership, nullable ownership, group-scoped invitation storage, participant-only access indexes for unresolved historical settlements, and invalidates legacy workspace invitation tokens while preserving their rows/status. It intentionally retains all workspace tables/columns and legacy group memberships. It has **not** been executed. MySQL DDL implicitly commits, so this script is not atomic or safely rerunnable: test it on a disposable restored copy, capture a backup, and restore that copy if execution stops partway through. The runner records a failed/partially applied version and refuses an automatic retry. The updated backend checks the migration ledger and required schema before enabling legacy-token invalidation; startup blocks if it detects incomplete or untracked Phase C objects. This is not yet a complete cutover migration.

Run manually only after restoring an isolated test copy and reviewing the target:

```powershell
$env:NODE_ENV = 'test'
$env:ALLOW_DEVELOPMENT_MIGRATIONS = 'true'
$env:DB_NAME = 'groupbuk_restored_test'
$env:DB_USER = 'groupbuk_integration_test'
$env:GROUPBUK_MIGRATION_EXPECTED_SERVER = 'local-mysql-server-name'
$env:GROUPBUK_MIGRATION_DB_MARKER = '<unique-random-marker-of-32-or-more-characters>'
npm run migrate:development
```

Supply `DB_HOST`, `DB_PORT`, and `DB_PASSWORD` for that local test database. Before running, provision `groupbuk_integration_guard` in the restored test database with a SHA-256 hash of the exact marker, its database name, and server hostname. The runner verifies those against `DATABASE()`, `@@hostname`, and read-only state before creating the migration ledger or executing SQL. It refuses production mode, DB names containing `prod`, `production`, or `live`, and users not named for test/integration. Do not use production credentials, a production DB name, or a production server.

The backend authorization module now has account/group membership and explicit admin/owner checks, in addition to the legacy workspace-aware check. The version-aware runner and startup schema compatibility detection exist, but no authenticated route currently consumes the new authorization helpers. Existing API routes still use workspace-scoped identity and data queries. Group invitation endpoints, ownership assignment endpoints, the historical settlement API, and remaining route-family adapters are not implemented yet. Do not treat this foundation as production-ready or as completion of Phase C.

### Session compatibility status

Migration `002` does not change `auth_sessions`; legacy sessions remain as-is. Login and session lookup still require an active workspace. Account-only sessions, session versioning/revocation policy, legacy-session migration/invalidation, and dual-read compatibility are not implemented. They must be introduced additively and tested before removing any workspace session dependency; no existing sessions should be invalidated implicitly.

### Phase C route status

The account/group helper is not yet wired into route handlers. `/api/groups`, expenses, balances, settlements, budgets, recurring expenses, reports, group activity, notifications, and user/account management still use workspace scoping in `backend/src/index.js`. No new group invitation lifecycle API, owner-resolution endpoint, or participant-only historical settlement read API exists yet. Existing financial calculations have not been changed; no migration-backed reconciliation has been performed.
