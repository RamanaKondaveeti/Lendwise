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

The Windows-hosted connectivity diagnostic is `npm run test:integration:preflight`. It reports config, DNS, TCP, MySQL authentication/database, server identity, marker, and temporary-table permission stages separately. It never runs migrations; it verifies server identity and the marker before its session-only temporary-table read/write probe. A failed DNS/TCP stage prevents database credentials from being used.

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

Migration `002` leaves `auth_sessions` unchanged. Migration `003` makes its workspace context nullable but leaves existing session rows and expiry/revocation behavior intact. Account lookup is account/person based, with optional validation of legacy workspace context against the account's existing workspace membership. No existing sessions are invalidated implicitly. Session versioning/revocation policy beyond logout/password reset and the frontend contract migration remain outstanding.

### Track B implementation status (development code only)

`003_track_b_account_identity.migration.sql` is an additive follow-on to `002`. It makes the legacy workspace reference nullable on people, accounts, auth sessions, and groups; it does not delete or reassign any existing records. It has **not** been executed. Startup now skips the legacy workspace backfill/NOT NULL normalizer only after the version ledger records `003` as applied and verifies all four columns are nullable. A failed or partial version blocks startup rather than being retried automatically.

After both migrations are applied to an isolated test database, signup without a legacy invitation creates an account and identity without a workspace. Login/session lookup authenticates by account and person; a legacy workspace is optional session context. Existing sessions retain their stored workspace context. Workspace APIs are explicitly gated and reject a session without a workspace; the new `/api/account/groups` endpoints use direct `group_accounts` authorization. This does not change the frontend contract.

Account group API currently supports list, create (creator becomes owner/admin), details/member list, update, and admin-controlled membership replacement using account IDs. It does not yet implement group invitations, member search, owner resolution for unassigned legacy groups, or safe group deletion. Financial and other route families remain workspace-scoped. Track B is a partial implementation and is not a completed migration.

### Remaining Phase C route status

The legacy `/api/groups` route and expense, balance, settlement, budget, recurring expense, report, activity, notification, and user/account routes still use workspace scoping in `backend/src/index.js`. New `/api/account/groups` supports direct account-group authorization but does not replace the legacy routes or their data adapters. No group invitation lifecycle API, owner-resolution endpoint, or participant-only historical settlement read API exists yet. Existing financial calculations have not been changed; no migration-backed reconciliation has been performed.
