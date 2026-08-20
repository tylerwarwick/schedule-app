# Coursemap

A course schedule and assignment tracker — Coursicle-style, but self-hosted with a real database. Weekly grid anchored to actual calendar dates, horizontal scroll/swipe between weeks, recurring classes, conflict detection, multiple schedule tabs, and an assignment tracker.

## How it's built

- **`server.js`** — Express API (schedules, classes, tasks)
- **`db/`** — data layer with two interchangeable backends:
  - `db/sqlite.js` — local file database, used automatically when there's no `DATABASE_URL` (zero-setup local dev)
  - `db/postgres.js` — used automatically when `DATABASE_URL` is set (Render, or any Postgres)
- **`public/`** — the frontend (plain HTML/CSS/JS, no build step, no framework)
- **`render.yaml`** — a Render Blueprint that deploys the API, a Postgres database, and the frontend as three separate services

The frontend talks to the API only through `fetch` — nothing is stored in the browser (no localStorage), so your schedule is the same wherever you open the site.

## Calendar behavior

Each week column shows the actual date (e.g. "Mon 17"), not just a generic weekday. Classes are defined once with a set of weekdays (e.g. Mon/Wed/Fri) and a time — they automatically recur on every matching weekday, indefinitely, in both directions. Navigate between weeks with the ‹ › buttons, the **Today** button, two-finger/trackpad horizontal scroll, or a swipe on mobile.

## Run it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Open **http://localhost:4173**. No database setup needed — it creates `data/coursemap.db` (SQLite) on first run, seeded with a small demo schedule.

## Deploy to Render (API + database + frontend, as separate services)

You said your GitHub is already attached to Render, so:

1. Push this project to a GitHub repo.
2. In the Render dashboard: **New → Blueprint**, pick that repo. Render reads `render.yaml` and shows you three resources it's about to create:
   - `coursemap-db` — a Postgres database
   - `coursemap-api` — the Express API (Node web service)
   - `coursemap-web` — the static frontend
3. Click **Apply**. Render provisions the database first, then builds and deploys both services.
4. Once deployed, open the `coursemap-web` URL (defaults to `https://coursemap-web.onrender.com`) — that's your app.

That's it — no manual environment variable wiring. The blueprint connects `coursemap-api` to `coursemap-db` automatically, and bakes `coursemap-api`'s URL into `coursemap-web` at build time via `public/config.js`.

**If you rename either service** in the Render dashboard (so it's not `coursemap-api`/`coursemap-web`), update the two hardcoded URLs in `render.yaml` (`ALLOWED_ORIGIN` and `API_BASE_URL`) to match before deploying, or the frontend and backend won't be able to reach each other.

### Two things to know about Render's free tier

- **Free Postgres expires 30 days after creation**, then Render deletes it (14-day grace period to upgrade first). Fine for trying this out; once you're actually using it for a real term, switch `coursemap-db`'s plan from `free` to `basic-256mb` (~$6-7/mo) in the Render dashboard — your schedule is worth more than that.
- **Free web services spin down after 15 minutes idle** and take 30-60 seconds to wake back up on the next request — you might see the "connecting…" status linger briefly the first time you open it after a while. This doesn't affect your data, only response time.

### Running the API and frontend as one service instead

If you'd rather not split them, `server.js` already serves `public/` itself — you could deploy just `coursemap-api` as a single Render web service (with `DATABASE_URL` pointed at a Postgres instance) and skip `coursemap-web`/`config.js` entirely, since same-origin requests just work. The blueprint here keeps them separate because you asked for API and site to run separately.

## API reference

| Method | Path                          | Does                                              |
|--------|-------------------------------|----------------------------------------------------|
| GET    | `/api/health`                 | `{ ok, db }` — which data layer is active          |
| GET    | `/api/state`                  | Full nested state (schedules + classes + tasks)    |
| PUT    | `/api/meta/active-schedule`   | Set which schedule tab is active                   |
| POST   | `/api/schedules`               | Create a schedule                                  |
| PUT    | `/api/schedules/:id`           | Rename / toggle weekends                           |
| DELETE | `/api/schedules/:id`           | Delete a schedule (cascades)                       |
| POST   | `/api/schedules/:id/classes`   | Add a class                                        |
| PUT    | `/api/classes/:id`             | Edit a class                                       |
| DELETE | `/api/classes/:id`             | Delete a class                                     |
| POST   | `/api/schedules/:id/tasks`     | Add a task                                         |
| PUT    | `/api/tasks/:id`               | Edit / mark done                                   |
| DELETE | `/api/tasks/:id`               | Delete a task                                      |
