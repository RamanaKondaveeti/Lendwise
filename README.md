# Lendwise

A responsive shared expense app starter inspired by the Splitwise workflow.

## Start with Docker
1. The provided `.env` has a generated database password. Keep it private, or set your own strong `DB_PASSWORD` before deployment.
2. Run `docker compose up --build -d` from this directory.
3. Open `http://15.252.10.1:3000` (or your server address).

The app is served on port 3000. The API is available on port 5000, and PostgreSQL is internal to the Compose network. Nginx serves the frontend and proxies `/api` to the backend. Vite proxies `/api` to localhost:5000 in development.

## Local development
Start PostgreSQL, copy `.env.example` to `.env`, then run `cd backend && npm install && npm run dev` and `cd frontend && npm install && npm run dev` in separate terminals. Set `DATABASE_URL` for the local database connection.

## Included
- Expense dashboard, recent activity and balances
- Add an expense with an equal split across everyone in your circles
- Create groups
- PostgreSQL persistence and demo data initialized on first startup
- Frontend and backend Dockerfiles plus Docker Compose

Authentication, invitations, participant selection, editing, settlements UI and production hardening remain future work.

