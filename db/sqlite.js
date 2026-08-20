// SQLite data layer — used automatically when no DATABASE_URL is set
// (i.e. local development). Mirrors db/postgres.js's exported API exactly.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "coursemap.db");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

async function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      show_weekends INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      instructor TEXT DEFAULT '',
      location TEXT DEFAULT '',
      color TEXT NOT NULL DEFAULT '#2D9C8F',
      days TEXT NOT NULL DEFAULT '[]',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      course_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      due TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const count = db.prepare("SELECT COUNT(*) AS n FROM schedules").get().n;
  if (count === 0) await seed();
}

async function seed() {
  const todayPlus = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const schedId = uid();
  const c1 = uid(), c2 = uid(), c3 = uid();

  db.prepare("INSERT INTO schedules (id, name, show_weekends, sort_order) VALUES (?,?,0,0)").run(schedId, "Demo Schedule");

  const insClass = db.prepare(
    "INSERT INTO classes (id, schedule_id, name, instructor, location, color, days, start_time, end_time) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  insClass.run(c1, schedId, "Cell Biology", "Dr. Okafor", "Sci Bldg 210", "#2D9C8F", JSON.stringify(["Mon", "Wed", "Fri"]), "09:00", "09:50");
  insClass.run(c2, schedId, "Biostatistics", "Dr. Reyes", "Math 118", "#E8A33D", JSON.stringify(["Tue", "Thu"]), "11:00", "12:20");
  insClass.run(c3, schedId, "Seminar: Rural Health", "Dr. Whitfield", "Health Sci 4", "#8E5A9E", JSON.stringify(["Wed"]), "14:00", "16:00");

  const insTask = db.prepare("INSERT INTO tasks (id, schedule_id, course_id, title, due, done) VALUES (?,?,?,?,?,0)");
  insTask.run(uid(), schedId, c2, "Problem set 3", todayPlus(2));
  insTask.run(uid(), schedId, c1, "Reading response", todayPlus(0));

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_schedule_id', ?)").run(schedId);
}

async function getState() {
  const schedules = db.prepare("SELECT * FROM schedules ORDER BY sort_order, created_at").all();
  const classesStmt = db.prepare("SELECT * FROM classes WHERE schedule_id = ?");
  const tasksStmt = db.prepare("SELECT * FROM tasks WHERE schedule_id = ? ORDER BY created_at");
  const active = db.prepare("SELECT value FROM meta WHERE key = 'active_schedule_id'").get();

  const out = schedules.map((s) => ({
    id: s.id,
    name: s.name,
    showWeekends: !!s.show_weekends,
    classes: classesStmt.all(s.id).map((c) => ({
      id: c.id, name: c.name, instructor: c.instructor, location: c.location,
      color: c.color, days: JSON.parse(c.days), start: c.start_time, end: c.end_time
    })),
    tasks: tasksStmt.all(s.id).map((t) => ({
      id: t.id, courseId: t.course_id, title: t.title, due: t.due, done: !!t.done
    }))
  }));

  return { schedules: out, activeScheduleId: active ? active.value : (out[0] ? out[0].id : null) };
}

async function scheduleExists(id) {
  return !!db.prepare("SELECT id FROM schedules WHERE id = ?").get(id);
}

async function setActiveSchedule(id) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_schedule_id', ?)").run(id);
}

async function createSchedule(name) {
  const id = uid();
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM schedules").get().m;
  db.prepare("INSERT INTO schedules (id, name, show_weekends, sort_order) VALUES (?,?,0,?)").run(id, name, maxOrder + 1);
  await setActiveSchedule(id);
  return id;
}

async function updateSchedule(id, { name, showWeekends }) {
  const fields = [];
  const vals = [];
  if (typeof name === "string") { fields.push("name = ?"); vals.push(name.trim() || "Untitled"); }
  if (typeof showWeekends === "boolean") { fields.push("show_weekends = ?"); vals.push(showWeekends ? 1 : 0); }
  if (fields.length) {
    vals.push(id);
    db.prepare(`UPDATE schedules SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  }
}

async function deleteSchedule(id) {
  db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  const remaining = db.prepare("SELECT id FROM schedules ORDER BY sort_order LIMIT 1").get();
  if (remaining) await setActiveSchedule(remaining.id);
}

async function addClass(scheduleId, b) {
  const id = uid();
  db.prepare(
    "INSERT INTO classes (id, schedule_id, name, instructor, location, color, days, start_time, end_time) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(id, scheduleId, b.name.trim(), (b.instructor || "").trim(), (b.location || "").trim(), b.color || "#2D9C8F", JSON.stringify(b.days), b.start, b.end);
  return id;
}

async function updateClass(id, b) {
  const existing = db.prepare("SELECT * FROM classes WHERE id = ?").get(id);
  if (!existing) return false;
  db.prepare(
    "UPDATE classes SET name=?, instructor=?, location=?, color=?, days=?, start_time=?, end_time=? WHERE id=?"
  ).run(
    (b.name ?? existing.name).trim(),
    (b.instructor ?? existing.instructor) || "",
    (b.location ?? existing.location) || "",
    b.color ?? existing.color,
    JSON.stringify(b.days ?? JSON.parse(existing.days)),
    b.start ?? existing.start_time,
    b.end ?? existing.end_time,
    id
  );
  return true;
}

async function deleteClass(id) {
  db.prepare("DELETE FROM classes WHERE id = ?").run(id);
}

async function addTask(scheduleId, b) {
  const id = uid();
  db.prepare("INSERT INTO tasks (id, schedule_id, course_id, title, due, done) VALUES (?,?,?,?,?,0)")
    .run(id, scheduleId, b.courseId || null, b.title.trim(), b.due || null);
  return id;
}

async function updateTask(id, b) {
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!existing) return false;
  db.prepare("UPDATE tasks SET title=?, due=?, done=?, course_id=? WHERE id=?").run(
    b.title ?? existing.title,
    b.due !== undefined ? b.due : existing.due,
    b.done !== undefined ? (b.done ? 1 : 0) : existing.done,
    b.courseId !== undefined ? b.courseId : existing.course_id,
    id
  );
  return true;
}

async function deleteTask(id) {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

module.exports = {
  kind: "sqlite",
  init, getState, scheduleExists, setActiveSchedule,
  createSchedule, updateSchedule, deleteSchedule,
  addClass, updateClass, deleteClass,
  addTask, updateTask, deleteTask
};
