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

The production backend refuses to start unless `APP_URL` uses HTTPS and `COOKIE_SECURE=true`. Docker Compose defaults secure cookies on and requires `APP_URL`; set `COOKIE_SECURE=false` only for a deliberate non-production HTTP test.

Back up the MySQL database and test restoring that backup before deployment or upgrades. The backend applies schema updates at startup. The workspace ownership migration gives each existing account its own workspace and account-linked person; previously shared, unowned people and groups are preserved in a separate `Legacy workspace` so they are not exposed to an arbitrary account. Those records are not visible through account workspaces and need a deliberate manual reassignment if they should remain in use. Run migrations on a restored copy first and verify the resulting data before deploying them to customer data.

### Database and uploaded-file backups

The repository includes `scripts/backup/groupbuk_backup.py`, a host-side Python 3 utility for Ubuntu/Debian. It runs `mysqldump --single-transaction` for a transaction-consistent InnoDB snapshot, compresses and validates the dump, writes a SHA-256 manifest, and stores each timestamped backup in a mode-700 directory. MySQL credentials are read from the ignored deployment `.env` and placed in a temporary mode-600 MySQL option file, never on the command line. Install the host tools with `sudo apt-get install python3 mysql-client` if they are not already present. Run commands from the repository root:

```bash
sudo python3 scripts/backup/groupbuk_backup.py backup
sudo python3 scripts/backup/groupbuk_backup.py verify /var/backups/groupbuk/groupbuk-YYYYMMDDTHHMMSSZ
```

Backups default to `/var/backups/groupbuk`; set `BACKUP_DIR` in the private `.env` to choose another host directory. `BACKUP_RETENTION_DAYS` defaults to 14 and may be set to a positive integer. Expired dated backup directories are removed only after a new database dump and any configured file archive have both completed and validated. Keep the backup directory on a protected disk with sufficient capacity; copy backups to a separate protected location for disaster recovery.

The application currently stores receipt OCR images in memory and does not persist receipt images, profile images, or user documents on disk. If a deployment adds a persistent upload directory, set `BACKUP_FILES_PATH=/absolute/path/to/uploads` in `.env` or pass `--files-path /absolute/path/to/uploads` to `backup`. The archive excludes cache/temp folders, temporary filenames, and links. Verify the exact path before enabling file backup.

Daily scheduling is optional and is not installed automatically. The default backup directory is root-owned, so run these commands with `sudo` (or configure a protected backup directory writable by the chosen service account). After verifying a manual backup, a host administrator can add this entry to root's crontab with `sudo crontab -e` (adjust the checkout and log paths):

```cron
15 2 * * * cd /home/ubuntu/LendWise && /usr/bin/flock -n /var/lock/groupbuk-backup.lock /usr/bin/python3 scripts/backup/groupbuk_backup.py backup >> /var/log/groupbuk-backup.log 2>&1
```

#### Safe restore and test restore

First verify the selected backup. Create a new empty test database on the same MySQL server, grant the backup user the required privileges on it, and import there. The tool refuses the configured application database and refuses any target that already contains tables. The explicit confirmation must exactly match the target database name:

```bash
sudo python3 scripts/backup/groupbuk_backup.py verify /var/backups/groupbuk/groupbuk-YYYYMMDDTHHMMSSZ
sudo python3 scripts/backup/groupbuk_backup.py restore-db /var/backups/groupbuk/groupbuk-YYYYMMDDTHHMMSSZ groupbuk_restore_test --confirm-target groupbuk_restore_test
```

Use credentials authorized for both the source application database and the test database. Do not point the test app at production. Review table counts and representative workspace, expense, split, settlement, and migration data in the restored database; run the application against the test database in an isolated environment to exercise startup migrations and application reads. `restore-db` only imports into a new empty target and does not issue `DROP DATABASE` or overwrite existing tables.

If the backup includes files, restore them to a new or empty destination. Confirmation must exactly match the resolved absolute path:

```bash
sudo python3 scripts/backup/groupbuk_backup.py restore-files /var/backups/groupbuk/groupbuk-YYYYMMDDTHHMMSSZ /srv/groupbuk-restore/uploads --confirm-target /srv/groupbuk-restore/uploads
```

After restoring files, review ownership and permissions and compare records that refer to uploaded files. Backups use InnoDB transaction consistency; nontransactional MySQL tables are not snapshot-consistent. Backup verification checks gzip integrity, expected dump markers, archive structure, and checksums; it does not prove that MySQL can import the dump. Only an isolated test restore verifies importability and application-level consistency. Protect backups as production data because they contain user and financial records.

For an initial production deployment, configure HTTPS at a reverse proxy or load balancer, then build and start the Compose services:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f backend
```

The frontend is published on port 3000 for the HTTPS proxy. The backend is only exposed on the internal Compose network and is not published directly. Route `/api` through the frontend proxy to the backend. Do not expose port 3000 directly to customers over plain HTTP.

### Logging and operational monitoring

The backend writes one-line JSON logs to stdout, so they are available through Docker Compose. API access records include the method, Express route template, status, duration, and request ID; query strings and request bodies are excluded. Error records include only an allowlisted error code/name, never the exception message or stack. The `X-Request-ID` header is accepted only when it contains a bounded safe identifier; otherwise the backend generates one and returns it in the response. API error JSON includes the same ID. Authentication failures, rate limits, readiness failures, and background-job failures are logged without credentials, tokens, or personal financial fields.

`GET /api/health/live` is the process liveness check and does not query MySQL. `GET /api/health/ready` checks MySQL with a bounded query and returns only `{ "ok": true }` or HTTP 503 with `{ "ok": false }`. The existing `/api/health` path remains as a readiness alias. Compose uses readiness for the backend container health status and rotates each service's JSON logs at 10 MB per file, keeping three files.

Useful host checks:

```bash
curl -fsS https://groupbuk.com/api/health/live
curl -fsS https://groupbuk.com/api/health/ready
docker compose ps
docker compose logs --since=15m backend
docker compose logs --since=15m frontend
docker stats --no-stream
df -h
free -h
```

After deploying the logging or health-check changes, recreate the services so Docker applies the updated health check and log rotation settings:

```bash
docker compose up -d --build
docker compose ps
```

Use a lightweight external HTTPS uptime check against `/api/health/ready` for customer-facing API availability; the endpoint reveals only binary availability, not infrastructure details. Review backend JSON access logs for 5xx status and high `durationMs` values, and readiness failures for database connectivity. Check `docker compose ps` for unhealthy/restarting containers, `docker stats` for container memory/CPU, and `df -h` for disk pressure, including Docker's data directory. The host reverse proxy's access/error logs provide the customer-edge view. These logs are not a metrics store and Docker rotation is finite; alert thresholds and log export/retention should be configured to match operational needs.

### Performance audit and API sampling

The repository includes read-only MySQL query-plan/index inspection and a sequential API latency sampler. Run the database audit from the repository root on a host that can reach MySQL:

```bash
node backend/scripts/performance-audit.js
```

It prints MySQL version, indexes for key financial/feed tables, and `EXPLAIN` plans for representative expense, trip, and notification queries. The plan uses zero-valued IDs only; replace those predicates with representative values in a controlled production session when validating selectivity. The script does not change schema or data.

Sample public endpoint latency from the host:

```bash
node backend/scripts/benchmark-api.js --base https://groupbuk.com --iterations 30 --path /api/health/live --path /api/health/ready
```

Add `--path /api/summary` or another authenticated endpoint to sample it. To authenticate, provide a session cookie through `GROUPBUK_BENCH_COOKIE` in the current shell environment; do not put a real cookie in command history or share benchmark output containing environment details. The sampler reports status counts, response bytes, and latency percentiles, never response bodies or cookie values. Take repeated before/after samples on the same host under comparable load; these are observational samples, not a production load test.

### Isolated MySQL integration tests

The database-backed workflow suite is opt-in and reads only `backend/.env.integration`; it never loads `.env` or inherited database credentials. Create a disposable MySQL database and dedicated account first, grant that account privileges only on that database, then copy `backend/.env.integration.example` to `backend/.env.integration` and set the actual test host, database name, MySQL-reported server hostname, account, password, and a private random marker. Use a name such as `groupbuk_integration_test` and a dedicated account such as `groupbuk_integration_test`. Do not use production credentials or point the test configuration at production.

The runner requires the exact destructive-test opt-in shown in the example. It checks the connected database and MySQL server identity, requires a writable server and a test-specific database and user name, and takes a database-scoped advisory lock. On first use it refuses any nonempty schema and installs a marker. Later runs require that marker and refuse accounts or workspaces outside its integration namespace. Cleanup removes only integration-test workspaces from the marked database; it never drops the database. The backend process receives only the integration database configuration and runs as `NODE_ENV=test`.

Run locally or on Ubuntu from `backend`:

```bash
npm test
npm run test:integration
```

The app startup initializes its schema in the test database before the suite begins. The recurrence test waits for the backend's scheduled worker (up to 70 seconds by default); set `INTEGRATION_RECURRING_WAIT_MS` to adjust that timeout. Keep `backend/.env.integration` out of version control and delete the test database/account when no longer needed. The guard reduces accidental-target risk but does not replace creating a separate MySQL server/database/user and independently verifying those credentials before opting in.

### EC2 host Nginx and Let's Encrypt

For an EC2 host running Ubuntu/Debian, the repository includes a temporary HTTP proxy at `deploy/nginx/groupbuk.com.http.conf` and the final TLS/canonical-host configuration at `deploy/nginx/groupbuk.com.https.conf.example`. The first proxies both names to the frontend on `127.0.0.1:3000`; the final redirects HTTP and `www` to `https://groupbuk.com` and proxies the apex host. These files are host Nginx configuration; the Nginx inside the frontend container continues to serve the built app and proxy `/api` to the backend.

Before changing the EC2 host, connect over SSH and inspect the OS, Nginx, port listeners, Compose services, and existing certificates. Do not overwrite another site's vhost or remove existing certificates. The host must accept inbound TCP 80 and 443 in its EC2 security group for public HTTP/HTTPS and the HTTP-01 certificate challenge. Keep SSH restricted to your administration IP; do not open backend port 5000 or MySQL port 3306. After confirming those checks, enable the temporary host vhost and test/reload Nginx. On a host with the Nginx Certbot plugin installed, run `sudo certbot --nginx --redirect -d groupbuk.com -d www.groupbuk.com`; follow its email prompt. Then install the final example config as the active vhost, run `sudo nginx -t`, and reload Nginx.

The production `.env` uses `APP_URL=https://groupbuk.com` and `COOKIE_SECURE=true`. The Compose frontend mapping binds port 3000 to loopback only, so apply that Compose change only after host Nginx is running. `docker compose up -d --no-deps backend frontend` applies the backend environment and frontend port mapping without rebuilding images or touching the database. The frontend uses relative `/api` paths and the existing same-origin reverse proxy; no CORS allowlist or OAuth callback change is needed. Verify automatic certificate renewal with `sudo certbot renew --dry-run`.

The required DNS records are `A @ 15.252.10.1` and `CNAME www groupbuk.com` (or `A www 15.252.10.1`). Avoid conflicting `AAAA` records unless the EC2 host is configured for IPv6.

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
- Expense and settlement creation accept an `Idempotency-Key` header. A key is scoped to the authenticated account, active workspace, and endpoint; retry with the same key and identical JSON body to receive the original success response. Reusing a key with a changed body returns HTTP 409. Expense creation, group settlements, expense-specific settlements, and bulk settlements are covered. Requests without a key remain supported for older clients and are not idempotent.
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

## Receipt OCR

Receipt scanning uses AWS Textract AnalyzeExpense. Set `AWS_REGION` and configure AWS credentials through the AWS SDK default credential chain (IAM role is preferred in production; `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optional `AWS_SESSION_TOKEN` are supported). Scanning accepts JPEG, PNG, and WebP images up to 8 MB; WebP is converted to PNG in memory. PDF is not supported by this synchronous endpoint. Images are never written to disk or returned to the browser. If `AWS_REGION` is unset, the API returns a configuration error while normal expense entry remains available.
