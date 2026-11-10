# GroupBuk

A responsive shared-expense app with private workspaces, database-backed accounts, groups, expenses, and settlements.

## Production deployment

The Docker Compose setup expects MySQL to be reachable from the backend container at `host.docker.internal:3306`. Create the database and a dedicated MySQL user with only the permissions required by GroupBuk; do not use the MySQL root account. Configure these values in the ignored `.env` file:

```dotenv
DB_NAME=lendwise
DB_USER=lendwiseuser
DB_PASSWORD=use-a-unique-strong-password
APP_URL=https://your-domain.example
COOKIE_SECURE=true
SMTP_HOST=mail.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-mailbox-user
SMTP_PASSWORD=your-mailbox-password
MAIL_FROM=GroupBuk <no-reply@your-domain.example>
```

Use the SMTP provider's required port and TLS settings. `APP_URL` must be the exact public HTTPS origin used by customers. For temporary HTTP testing, `COOKIE_SECURE=false` allows session cookies over HTTP, and email variables may be left unset so the backend can start. Signup and login do not require email delivery. Password recovery and invitation emails require SMTP; when an invitation email cannot be sent, the app provides a shareable invitation link. HTTP and non-secure cookies are not safe for customer use; configure HTTPS and set `COOKIE_SECURE=true` before release. Keep `.env` private and out of version control.

Back up the MySQL database and test restoring that backup before deployment or upgrades. The backend applies schema updates at startup. The workspace ownership migration gives each existing account its own workspace and account-linked person; previously shared, unowned people and groups are preserved in a separate `Legacy workspace` so they are not exposed to an arbitrary account. Those records are not visible through account workspaces and need a deliberate manual reassignment if they should remain in use. Run migrations on a restored copy first and verify the resulting data before deploying them to customer data.

After HTTPS is configured at a reverse proxy or load balancer, run:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f backend
```

The frontend is published on port 3000 for the HTTPS proxy. The backend is only exposed on the internal Compose network and is not published directly. Route `/api` through the frontend proxy to the backend. Do not expose port 3000 directly to customers over plain HTTP.

## Local development

For local development, configure `DB_HOST`, `DB_PORT`, `DB_NAME` (normally `lendwise`), `DB_USER`, and `DB_PASSWORD` in `.env`, then run `npm install` and `npm run dev` in `backend`, and `npm install` and `npm run dev` in `frontend` in separate terminals. Account signup and login do not require email delivery. Password recovery requires SMTP; invitation links can be shared manually when SMTP is unavailable.

## Included

- Private workspace data isolation for people, groups, expenses, and settlements
- Search registered account names globally and invite accounts into additional workspaces
- Switch between workspaces an account has joined
- Email/password signup and login with scrypt password hashes and database-backed sessions
- Password reset and workspace invitation links
- Rate limiting, security headers, and request body limits; secure cookies when `COOKIE_SECURE=true`
- Manual creation of people and groups; no generated sample or dummy records
- MySQL persistence for groups, group members, expenses, splits, and settlements
- Group-level net balances use expense shares and linked or group-assigned settlements; amounts are stored in INR and can be displayed in INR or converted to USD using the latest available rate from Frankfurter
- Suggested settlements are calculated independently per group in stored INR using an exact minimum-transfer search; the currency selector affects display and form input conversion, not the underlying balance calculation
- Record full or custom partial expense-share payments individually, or review and confirm suggested payments to clear your own balance
- Recurring expense templates retain their configured INR/USD amount and conversion rate; generated expenses are stored in the existing INR base and use the same split, balance, settlement, and analytics rules
- The backend checks for due recurring expenses at startup and once per minute. A database row lock plus a unique `(template_id, occurrence_date)` key makes generation transaction-safe and safe to retry; variable bills remain pending until an actual amount is confirmed
- Occurrence history is retained with the template and links each generated expense to its scheduled date. Pausing or deactivating a template does not remove expenses already generated
- Account-specific notifications cover expense changes, settlements, invitations, group membership, and recurring occurrences; the header notification center polls every 30 seconds and supports read/dismiss actions across joined workspaces
- Notification preferences are account-scoped, including daily/weekly/off settlement reminders. The backend checks outstanding group balances at startup and every 15 minutes; unique per-account reminder keys prevent duplicate reminders within the selected period
- Reports provide workspace-scoped expense, monthly, group, member, settlement, and outstanding-balance views with date, group, member, category, and currency controls. CSV, Excel, and PDF exports use database records and recorded split amounts; the API paginates results and exports up to 5,000 matching rows per download. Amounts remain stored in INR and USD is a presentation conversion using the current display rate.
- Light, dark, and system appearance preferences are stored locally per account in the browser; system mode follows the device color preference. The mobile sidebar opens as a dismissible navigation drawer.

## Before customer release

- Test signup, login, password reset, invitations, and workspace isolation against the production MySQL version and SMTP provider.
- Test upgrades and restores using a separate database copy; do not rely on an untested first-run migration.
- Configure and verify HTTPS, SMTP, MySQL backups, monitoring, and an incident-response contact.
- Define and implement customer data export/deletion and retention procedures before accepting customer data.

Registered account display names are globally searchable so people can invite existing users. Search results reveal names only; email addresses are sent only as part of invitations. Accepting an invite adds a workspace membership without moving or merging the user's existing workspace data.
