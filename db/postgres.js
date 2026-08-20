// Postgres data layer — used automatically when DATABASE_URL is set
// (e.g. on Render, pointed at a Render Postgres instance).
// Mirrors db/sqlite.js's exported API exactly.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
});

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      show_weekends BOOLEAN NOT NULL DEFAULT false,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      instructor TEXT DEFAULT '',
      location TEXT DEFAULT '',
      color TEXT NOT NULL DEFAULT '#2D9C8F',
      days JSONB NOT NULL DEFAULT '[]',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      course_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      due TEXT,
      done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM schedules");
  if (rows[0].n === 0) await seed();
}

async function seed() {
  const todayPlus = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const schedId = uid();
  const c1 = uid(), c2 = uid(), c3 = uid();

  await pool.query("INSERT INTO schedules (id, name, show_weekends, sort_order) VALUES ($1,$2,false,0)", [schedId, "Demo Schedule"]);

  const insClass = "INSERT INTO classes (id, schedule_id, name, instructor, location, color, days, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)";
  await pool.query(insClass, [c1, schedId, "Cell Biology", "Dr. Okafor", "Sci Bldg 210", "#2D9C8F", JSON.stringify(["Mon", "Wed", "Fri"]), "09:00", "09:50"]);
  await pool.query(insClass, [c2, schedId, "Biostatistics", "Dr. Reyes", "Math 118", "#E8A33D", JSON.stringify(["Tue", "Thu"]), "11:00", "12:20"]);
  await pool.query(insClass, [c3, schedId, "Seminar: Rural Health", "Dr. Whitfield", "Health Sci 4", "#8E5A9E", JSON.stringify(["Wed"]), "14:00", "16:00"]);

  const insTask = "INSERT INTO tasks (id, schedule_id, course_id, title, due, done) VALUES ($1,$2,$3,$4,$5,false)";
  await pool.query(insTask, [uid(), schedId, c2, "Problem set 3", todayPlus(2)]);
  await pool.query(insTask, [uid(), schedId, c1, "Reading response", todayPlus(0)]);

  await pool.query(
    "INSERT INTO meta (key, value) VALUES ('active_schedule_id', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [schedId]
  );
}

async function getState() {
  const { rows: schedules } = await pool.query("SELECT * FROM schedules ORDER BY sort_order, created_at");
  const { rows: active } = await pool.query("SELECT value FROM meta WHERE key = 'active_schedule_id'");

  const out = [];
  for (const s of schedules) {
    const { rows: classes } = await pool.query("SELECT * FROM classes WHERE schedule_id = $1", [s.id]);
    const { rows: tasks } = await pool.query("SELECT * FROM tasks WHERE schedule_id = $1 ORDER BY created_at", [s.id]);
    out.push({
      id: s.id,
      name: s.name,
      showWeekends: !!s.show_weekends,
      classes: classes.map((c) => ({
        id: c.id, name: c.name, instructor: c.instructor, location: c.location,
        color: c.color, days: c.days, start: c.start_time, end: c.end_time
      })),
      tasks: tasks.map((t) => ({
        id: t.id, courseId: t.course_id, title: t.title, due: t.due, done: !!t.done
      }))
    });
  }

  return { schedules: out, activeScheduleId: active[0] ? active[0].value : (out[0] ? out[0].id : null) };
}

async function scheduleExists(id) {
  const { rows } = await pool.query("SELECT id FROM schedules WHERE id = $1", [id]);
  return rows.length > 0;
}

async function setActiveSchedule(id) {
  await pool.query(
    "INSERT INTO meta (key, value) VALUES ('active_schedule_id', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [id]
  );
}

async function createSchedule(name) {
  const id = uid();
  const { rows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) AS m FROM schedules");
  await pool.query("INSERT INTO schedules (id, name, show_weekends, sort_order) VALUES ($1,$2,false,$3)", [id, name, rows[0].m + 1]);
  await setActiveSchedule(id);
  return id;
}

async function updateSchedule(id, { name, showWeekends }) {
  const fields = [];
  const vals = [];
  let i = 1;
  if (typeof name === "string") { fields.push(`name = $${i++}`); vals.push(name.trim() || "Untitled"); }
  if (typeof showWeekends === "boolean") { fields.push(`show_weekends = $${i++}`); vals.push(showWeekends); }
  if (fields.length) {
    vals.push(id);
    await pool.query(`UPDATE schedules SET ${fields.join(", ")} WHERE id = $${i}`, vals);
  }
}

async function deleteSchedule(id) {
  await pool.query("DELETE FROM schedules WHERE id = $1", [id]);
  const { rows } = await pool.query("SELECT id FROM schedules ORDER BY sort_order LIMIT 1");
  if (rows[0]) await setActiveSchedule(rows[0].id);
}

async function addClass(scheduleId, b) {
  const id = uid();
  await pool.query(
    "INSERT INTO classes (id, schedule_id, name, instructor, location, color, days, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, scheduleId, b.name.trim(), (b.instructor || "").trim(), (b.location || "").trim(), b.color || "#2D9C8F", JSON.stringify(b.days), b.start, b.end]
  );
  return id;
}

async function updateClass(id, b) {
  const { rows } = await pool.query("SELECT * FROM classes WHERE id = $1", [id]);
  const existing = rows[0];
  if (!existing) return false;
  await pool.query(
    "UPDATE classes SET name=$1, instructor=$2, location=$3, color=$4, days=$5, start_time=$6, end_time=$7 WHERE id=$8",
    [
      (b.name ?? existing.name).trim(),
      (b.instructor ?? existing.instructor) || "",
      (b.location ?? existing.location) || "",
      b.color ?? existing.color,
      JSON.stringify(b.days ?? existing.days),
      b.start ?? existing.start_time,
      b.end ?? existing.end_time,
      id
    ]
  );
  return true;
}

async function deleteClass(id) {
  await pool.query("DELETE FROM classes WHERE id = $1", [id]);
}

async function addTask(scheduleId, b) {
  const id = uid();
  await pool.query(
    "INSERT INTO tasks (id, schedule_id, course_id, title, due, done) VALUES ($1,$2,$3,$4,$5,false)",
    [id, scheduleId, b.courseId || null, b.title.trim(), b.due || null]
  );
  return id;
}

async function updateTask(id, b) {
  const { rows } = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
  const existing = rows[0];
  if (!existing) return false;
  await pool.query(
    "UPDATE tasks SET title=$1, due=$2, done=$3, course_id=$4 WHERE id=$5",
    [
      b.title ?? existing.title,
      b.due !== undefined ? b.due : existing.due,
      b.done !== undefined ? b.done : existing.done,
      b.courseId !== undefined ? b.courseId : existing.course_id,
      id
    ]
  );
  return true;
}

async function deleteTask(id) {
  await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
}

module.exports = {
  kind: "postgres",
  init, getState, scheduleExists, setActiveSchedule,
  createSchedule, updateSchedule, deleteSchedule,
  addClass, updateClass, deleteClass,
  addTask, updateTask, deleteTask
};
