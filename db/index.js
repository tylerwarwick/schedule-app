// Picks the Postgres data layer when DATABASE_URL is present (Render, or any
// hosted Postgres), and falls back to a local SQLite file otherwise (plain
// local dev with zero setup).

module.exports = process.env.DATABASE_URL
  ? require("./postgres")
  : require("./sqlite");
