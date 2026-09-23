import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./core.js";

export { ensureDefaultUser, nowIso, runMigrations, type DB } from "./core.js";

export function openDatabase(file: string): DB & Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db as DB & Database.Database;
}

export function defaultDbFile(): string {
  return process.env.DATABASE_FILE ?? path.resolve(process.cwd(), "data", "clubn.db");
}
