// Runtime-agnostic database helpers (no Node-only imports), shared by the
// Node server (better-sqlite3) and the in-browser demo (sql.js).
import { MIGRATIONS } from "./migrations.js";

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

/** Minimal synchronous SQLite interface used by the services. */
export interface DB {
  prepare(sql: string): Statement;
  exec(sql: string): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction<F extends (...args: any[]) => any>(fn: F): (...args: Parameters<F>) => ReturnType<F>;
}

export const DEFAULT_OPERATORS: [string, string][] = [
  ["Thomaz", "thomaz@clubn.local"],
  ["Lucas", "lucas@clubn.local"],
  ["Marcos", "marcos@clubn.local"],
];

export function nowIso(): string {
  return new Date().toISOString();
}

/** Applies pending migrations inside a transaction. Returns the ids applied. */
export function runMigrations(db: DB): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id));
  const done: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, name) VALUES (?, ?)").run(migration.id, migration.name);
    })();
    done.push(migration.id);
  }
  return done;
}

/** Guarantees at least one operator exists so actions are always attributed. */
export function ensureDefaultUser(db: DB): void {
  const count = (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
  if (count === 0) {
    for (const [name, email] of DEFAULT_OPERATORS) db.prepare("INSERT OR IGNORE INTO users (name, email) VALUES (?, ?)").run(name, email);
  }
}
