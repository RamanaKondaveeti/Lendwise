# Lendwise

A responsive shared expense app starter inspired by the Splitwise workflow.

## Start with Docker
1. Make sure your standalone MySQL server is running on port 3306, and the database and user in `.env` exist and can connect from Docker.
2. Run `docker compose up --build -d` from this directory.
3. Open `http://15.252.10.1:3000` (or your server address).

The app is served on port 3000. The API is available on port 5000 and connects to MySQL on the Docker host at `host.docker.internal:3306`. Nginx serves the frontend and proxies `/api` to the backend. Vite proxies `/api` to localhost:5000 in development.

Before exposing the app publicly, serve it behind HTTPS and set `COOKIE_SECURE=true` in `.env`; do not send account passwords over plain HTTP.

## Local development
Start MySQL, configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in your local `.env`, then run `cd backend && npm install && npm run dev` and `cd frontend && npm install && npm run dev` in separate terminals. The backend initializes or migrates tables on startup. Create an account with an email and password, then sign in to the workspace. Each account is stored in MySQL with a scrypt-hashed password and a linked workspace person. Accounts currently share the same workspace data. Set `COOKIE_SECURE=true` when serving through HTTPS.

## Included
- Database-driven overview, group details, full expense activity, and balances screens
- Create groups, assign users to groups, and add expenses shared among group members
- Record settlements and see balances recalculated from expenses, splits, and payments
- MySQL persistence with no automatically generated people, groups, expenses, or settlements
- Email/password signup and login with database-backed accounts and sessions
- Frontend and backend Dockerfiles plus Docker Compose

The first person in the database is used as the current account because authentication and invitations are not included yet. Existing database records are preserved; startup no longer adds sample records. Editing expenses and production hardening remain future work.
