// Adapts sql.js (SQLite compiled to JavaScript) to the small synchronous API
// the services use (the same subset of better-sqlite3), so the demo runs the
// real server logic entirely in the browser.
import type { Database, SqlValue } from "sql.js";
import type { DB, Statement } from "../../server/db/core";

function toSql(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" || typeof value === "string" || value instanceof Uint8Array) return value;
  return String(value);
}

export function adaptSqlJs(raw: Database, onWrite?: () => void): DB {
  let depth = 0;
  const lastInsertId = () => Number(raw.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);

  const prepare = (sql: string): Statement => ({
    get(...params) {
      const st = raw.prepare(sql);
      try {
        st.bind(params.map(toSql));
        return st.step() ? st.getAsObject() : undefined;
      } finally {
        st.free();
      }
    },
    all(...params) {
      const st = raw.prepare(sql);
      const rows: unknown[] = [];
      try {
        st.bind(params.map(toSql));
        while (st.step()) rows.push(st.getAsObject());
      } finally {
        st.free();
      }
      return rows;
    },
    run(...params) {
      raw.run(sql, params.map(toSql));
      const changes = raw.getRowsModified();
      const result = { changes, lastInsertRowid: lastInsertId() };
      if (depth === 0) onWrite?.();
      return result;
    },
  });

  return {
    prepare,
    exec(sql: string) {
      raw.exec(sql);
      if (depth === 0) onWrite?.();
    },
    transaction(fn) {
      return (...args) => {
        const name = `sp${depth}`;
        raw.exec(depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
        depth++;
        try {
          const result = fn(...args);
          depth--;
          raw.exec(depth === 0 ? "COMMIT" : `RELEASE ${name}`);
          if (depth === 0) onWrite?.();
          return result;
        } catch (error) {
          depth--;
          raw.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
          throw error;
        }
      };
    },
  };
}
