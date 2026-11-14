# GroupBuk workspace removal — Phase B migration design

## Scope and evidence

This document records a design only. No application code, schema, or data was changed. No production database was accessed, and no restored test database was available for executing the preflight queries.

Reviewed the current schema, group creation path, and repository history for the groups table. The current `groups` table has `id`, `workspace_id`, name/icon/color, and `created_at`; it has no creator/owner field. The current group creation insert in `backend/src/index.js` writes workspace, name, icon, and color only. `group_activity` has no group-created event; its actor data is not evidence of group creation. The repo history inspected contains no group creator field in the historical schema versions reviewed. `group_members.created_at` records membership time, not who created the group.

The current `settlements` schema allows nullable `expense_id` and `group_id`. Workspace invitations retain `accepted_at`, `cancelled_at`, `revoked_token_hash`, token hash, sender, invitee account, and expiry data. These fields support preserving invitation history and invalidating old tokens without fabricating a cancelled/accepted state.

## 1. Approved legacy invitation behavior

1. Keep every legacy workspace invitation row and its original status/timestamps/sender/invitee/email as historical audit data.
2. Do not fan a workspace invitation out into invitations for all groups and do not add membership for either pending or previously accepted workspace invitations as a side effect of this migration.
3. Invalidate legacy workspace tokens at cutover. Keep their audit rows; preserve the old token hash in the existing revocation field or use an explicit legacy-disabled marker in a future additive migration. Do not change `accepted_at` or `cancelled_at` merely to make the old token unusable.
4. Group invitation acceptance must look up a newly issued group-scoped invitation. It must never treat a workspace token as authorization to join any migrated group.
5. Users holding a pending legacy link should be informed that it no longer grants access. They should contact the original sender or an authorized member of the intended group and request a new group-specific invitation.
6. Retain history for audit. Where possible, expose it to the original sender and the matched invitee account; email-only invitees without an account remain sender-visible history until identity is established.

## 2. Group ownership rules

### Evidence rules

- Prefer an explicit historical group creator identifier or an auditable creation event that binds an actor to that exact group, if one is discovered in the restored database, backup logs, or external audit records.
- Validate that the referenced actor maps deterministically to an account/person in the migrated group. Record the evidence source and mapping decision.
- Never infer ownership from first group membership timestamp, lowest account/person ID, expense payer, settlement creator, frequent activity, or apparent administrator status.
- The current schema and group creation route reviewed do not persist a creator or owner, and current group activity has no creation event. Thus, current source alone does not establish an owner for any existing group.

### Ambiguous/missing owner resolution

Preflight inventory should classify each group as `evidence_mapped`, `needs_assignment`, or `conflict`. The SQL roster output is descriptive only; membership ordering is not an ownership recommendation. If reliable historical evidence is absent, preserve the group and memberships with no assigned owner and flag it for resolution. Proposed safe resolution: require an explicit, logged decision from an authorized account-holder or unanimous current group-member nomination/approval; retain the decision maker, timestamp, and reason. Do not grant elevated permissions until resolved. Exact owner-resolution workflow remains an approval decision below.

## 3. Settlement mapping rules

### Safe mapping

- Keep settlements with an existing valid `group_id` in that group, after checking the group and both participant identities are consistent.
- For a settlement with null `group_id`, use its valid `expense_id` to identify the expense's group only if the link resolves, the expense and settlement participants are consistent with that group, and there is no conflicting group evidence. Preserve the original `expense_id` and financial values. Record that this is an association derived from an explicit expense link.

### Unresolved mapping

- If `expense_id` is null, invalid, points to a deleted/unavailable expense, or conflicts with other evidence, do not infer a group from payer/payee membership.
- A shared-group candidate count of one is still not proof that the settlement belongs to that group; multiple candidates are explicitly ambiguous. The preflight reports these as review clues only.
- Preserve unresolved rows and values with `group_id` null. Keep them accessible in a separate read-only “Historical settlements” area scoped to the payer/payee identities (and authorized support/admin access), not in group balance calculations, settlement suggestions, or group-specific payment actions. If identities cannot yet be linked to accounts, retain them in an unresolved identity queue rather than dropping them.
- Preserve record IDs, payer, payee, amount, currency/financial representation (where present), note, creator, and timestamps. No historical value is recalculated or rewritten.

## 4. Counts from restored test database

No restored test database was available, so exact counts of owner-unassigned groups, pending legacy invitations, safely linkable settlements, unresolved settlements, identity conflicts, or membership anomalies are **unavailable**. Run `001_group_migration_preflight.sql` on the restored test copy and attach its complete output and backup identifier before preparing a write migration. The settlement counts in the script are triage counts; each candidate still needs consistency validation.

## 5. Updated migration sequence (design, not executed)

1. Take a transactionally consistent backup and verify a restorable copy. Record baseline counts/checksums and the exact application/schema version.
2. Run the read-only preflight on the restored test copy. Resolve identity collisions and cross-workspace membership anomalies with reviewed mapping tables; do not infer from financial activity.
3. Prepare explicit, reviewable mappings for account/person consolidation, group ownership (including unresolved status), settlement associations, and any other legacy records. Reject the migration if a record lacks a safe rule; retain it in an unresolved historical state where applicable.
4. Design additive schema changes only: group-scoped membership roles/invitation tables, nullable owner or explicit owner-resolution status, and any needed legacy-history markers. Keep old workspace structures and foreign keys during the compatibility period.
5. Deploy compatibility code capable of reading both old and new records without widening group access. Stop issuing workspace invitations; invalidate legacy workspace tokens; create group invitations only through authorized group workflows.
6. Backfill in a transaction or restartable batches from approved mapping tables. Preserve source IDs and financial values. Do not fan out invitations or assign an unlinked settlement to a group.
7. Verify post-migration record counts, sums of expenses/splits/settlements, participant references, invitation audit totals, and representative authorization behavior against the saved baseline.
8. Cut traffic to group-scoped reads/writes only after verification; retain legacy tables/columns and compatibility reads for the agreed observation period. Decommission old schema only in a later separately approved phase.

## 6. Rollback plan

- Before writes, retain an immutable backup and a tested restore procedure. The restore point is the authoritative rollback for any financial or identity corruption.
- Keep schema changes additive and legacy data intact. Do not drop workspace tables/columns, rewrite historical values, or delete invitation records in this phase.
- Make backfills restartable and journal applied batches/mappings. If verification fails, stop traffic to the new path and restore the backup, or reverse only additive rows/columns using the migration journal after confirming no post-cutover writes depend on them.
- Rollback must not reactivate legacy invitation tokens. Keep them invalid even if the application is rolled back; recipients can receive newly issued group invitations after service recovery.
- Re-run baseline comparisons after rollback and record any post-backup writes requiring reconciliation.

## 7. Remaining approvals

1. Approve the owner resolution process for groups with no reliable creator evidence: authorized account-holder decision, unanimous current-member nomination, or a specified combination; define who can perform the decision if members are inactive.
2. Approve whether unresolved settlements should be visible to payer/payee accounts in a dedicated read-only historical view, and who may resolve their group association. The recommended default is read-only visibility to both linked parties and no group-balance effect until an auditable resolution.
3. Approve how long legacy workspace invitation history remains visible and whether email-only pending invitees should receive a one-time notice to request a replacement invite.
4. Approve the compatibility/observation period and objective exit criteria before any later removal of workspace schema. No workspace tables or columns should be removed as part of Phase B.
