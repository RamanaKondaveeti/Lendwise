# Lendwise

A responsive shared-expense app with private workspaces, database-backed accounts, groups, expenses, and settlements.

## Production deployment

The Docker Compose setup expects MySQL to be reachable from the backend container at `host.docker.internal:3306`. Create the database and a dedicated MySQL user with only the permissions required by Lendwise; do not use the MySQL root account. Configure these values in the ignored `.env` file:

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
MAIL_FROM=Lendwise <no-reply@your-domain.example>
```

Use the SMTP provider's required port and TLS settings. `APP_URL` must be the exact public HTTPS origin used by customers. For temporary HTTP testing, `COOKIE_SECURE=false` allows session cookies over HTTP, and email variables may be left unset so the backend can start. Account signup verification, password recovery, and invitations still require valid SMTP settings. HTTP and non-secure cookies are not safe for customer use; configure HTTPS and set `COOKIE_SECURE=true` before release. Keep `.env` private and out of version control.

Back up the MySQL database and test restoring that backup before deployment or upgrades. The backend applies schema updates at startup. The workspace ownership migration gives each existing account its own workspace and account-linked person; previously shared, unowned people and groups are preserved in a separate `Legacy workspace` so they are not exposed to an arbitrary account. Those records are not visible through account workspaces and need a deliberate manual reassignment if they should remain in use. Run the migration on a restored copy first and verify the resulting data before deploying it to customer data.

After HTTPS is configured at a reverse proxy or load balancer, run:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f backend
```

The frontend is published on port 3000 for the HTTPS proxy. The backend is only exposed on the internal Compose network and is not published directly. Route `/api` through the frontend proxy to the backend. Do not expose port 3000 directly to customers over plain HTTP.

## Local development

For local development, configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in `.env`, then run `npm install` and `npm run dev` in `backend`, and `npm install` and `npm run dev` in `frontend` in separate terminals. Account signup and login do not require email delivery. Password recovery and workspace invitations require valid SMTP settings.

## Included

- Private workspace data isolation for people, groups, expenses, and settlements
- Email/password signup and login with scrypt password hashes and database-backed sessions
- Password reset and workspace invitation links
- Rate limiting, security headers, and request body limits; secure cookies when `COOKIE_SECURE=true`
- Manual creation of people and groups; no generated sample or dummy records
- MySQL persistence for groups, group members, expenses, splits, and settlements

## Before customer release

- Test signup, login, password reset, invitations, and workspace isolation against the production MySQL version and SMTP provider.
- Test upgrades and restores using a separate database copy; do not rely on an untested first-run migration.
- Configure and verify HTTPS, SMTP, MySQL backups, monitoring, and an incident-response contact.
- Define and implement customer data export/deletion and retention procedures before accepting customer data.
