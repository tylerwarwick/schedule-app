// Coursemap API server.
// Local dev: no DATABASE_URL -> SQLite file at ./data/coursemap.db
// Render:    DATABASE_URL set (Render Postgres) -> db/postgres.js
//
// Run with: npm start   (defaults to http://localhost:4173)

const path = require("path");
const express = require("express");
const cors = require("cors");
const db = require("./db");

const PORT = process.env.PORT || 4173;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// Serve the frontend too when it's sitting in ./public (combined local
// dev mode, or a single-service Render deploy). If you split the
// frontend into its own Render static site, this just goes unused.
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, db: db.kind });
});

app.get("/api/state", async (req, res) => {
  res.json(await db.getState());
});

app.put("/api/meta/active-schedule", async (req, res) => {
  const { scheduleId } = req.body;
  if (!(await db.scheduleExists(scheduleId))) return res.status(404).json({ error: "schedule not found" });
  await db.setActiveSchedule(scheduleId);
  res.json({ ok: true });
});

// ---- schedules ----
app.post("/api/schedules", async (req, res) => {
  const name = (req.body.name || "New Schedule").trim() || "New Schedule";
  await db.createSchedule(name);
  res.json(await db.getState());
});

app.put("/api/schedules/:id", async (req, res) => {
  if (!(await db.scheduleExists(req.params.id))) return res.status(404).json({ error: "schedule not found" });
  await db.updateSchedule(req.params.id, req.body);
  res.json(await db.getState());
});

app.delete("/api/schedules/:id", async (req, res) => {
  if (!(await db.scheduleExists(req.params.id))) return res.status(404).json({ error: "schedule not found" });
  await db.deleteSchedule(req.params.id);
  res.json(await db.getState());
});

// ---- classes ----
app.post("/api/schedules/:id/classes", async (req, res) => {
  if (!(await db.scheduleExists(req.params.id))) return res.status(404).json({ error: "schedule not found" });
  const b = req.body;
  if (!b.name || !Array.isArray(b.days) || b.days.length === 0 || !b.start || !b.end) {
    return res.status(400).json({ error: "name, days[], start, end are required" });
  }
  await db.addClass(req.params.id, b);
  res.json(await db.getState());
});

app.put("/api/classes/:id", async (req, res) => {
  const ok = await db.updateClass(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: "class not found" });
  res.json(await db.getState());
});

app.delete("/api/classes/:id", async (req, res) => {
  await db.deleteClass(req.params.id);
  res.json(await db.getState());
});

// ---- tasks ----
app.post("/api/schedules/:id/tasks", async (req, res) => {
  if (!(await db.scheduleExists(req.params.id))) return res.status(404).json({ error: "schedule not found" });
  const b = req.body;
  if (!b.title) return res.status(400).json({ error: "title is required" });
  await db.addTask(req.params.id, b);
  res.json(await db.getState());
});

app.put("/api/tasks/:id", async (req, res) => {
  const ok = await db.updateTask(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: "task not found" });
  res.json(await db.getState());
});

app.delete("/api/tasks/:id", async (req, res) => {
  await db.deleteTask(req.params.id);
  res.json(await db.getState());
});

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Coursemap API running at http://localhost:${PORT} (db: ${db.kind})`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
