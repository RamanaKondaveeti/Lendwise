# Lendwise

A responsive shared expense app starter inspired by the Splitwise workflow.

## Start with Docker
1. Make sure your standalone MySQL server is running on port 3306, and the database and user in `.env` exist and can connect from Docker.
2. Run `docker compose up --build -d` from this directory.
3. Open `http://15.252.10.1:3000` (or your server address).

The app is served on port 3000. The API is available on port 5000 and connects to MySQL on the Docker host at `host.docker.internal:3306`. Nginx serves the frontend and proxies `/api` to the backend. Vite proxies `/api` to localhost:5000 in development.

## Local development
Start MySQL, create the database and grant the configured user access, copy `.env.example` to `.env`, then run `cd backend && npm install && npm run dev` and `cd frontend && npm install && npm run dev` in separate terminals. The backend reads `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`; it initializes the tables and demo data on first startup.

## Included
- Expense dashboard, recent activity and balances
- Add an expense with an equal split across everyone in your circles
- Create groups
- MySQL persistence and demo data initialized on first startup
- Frontend and backend Dockerfiles plus Docker Compose

Authentication, invitations, participant selection, editing, settlements UI and production hardening remain future work.
