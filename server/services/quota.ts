import { emptyQuota, registerSend, viewQuota, type QuotaState, type QuotaView } from "../../shared/sendQuota.js";
import type { DB } from "../db/core.js";
import { HttpError } from "../lib/http.js";

interface Row {
  cycle_started_at: string | null;
  session_index: number;
  session_count: number;
  total_count: number;
  locked_until: string | null;
}

function load(db: DB, userId: number): QuotaState {
  const row = db.prepare("SELECT * FROM operator_send_quota WHERE user_id = ?").get(userId) as Row | undefined;
  if (!row) return emptyQuota();
  return {
    cycleStartedAt: row.cycle_started_at,
    sessionIndex: row.session_index,
    sessionCount: row.session_count,
    totalCount: row.total_count,
    lockedUntil: row.locked_until,
  };
}

function save(db: DB, userId: number, s: QuotaState, now: Date) {
  db.prepare(
    `INSERT INTO operator_send_quota (user_id, cycle_started_at, session_index, session_count, total_count, locked_until, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET cycle_started_at = excluded.cycle_started_at, session_index = excluded.session_index,
       session_count = excluded.session_count, total_count = excluded.total_count, locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
  ).run(userId, s.cycleStartedAt, s.sessionIndex, s.sessionCount, s.totalCount, s.lockedUntil, now.toISOString());
}

export function getQuota(db: DB, userId: number, now = new Date()): QuotaView {
  return viewQuota(load(db, userId), now);
}

/** Counts one send for the operator or throws 429 while the operator is paused. */
export function consumeQuota(db: DB, userId: number, now = new Date()): { messageType: number; quota: QuotaView } {
  const result = registerSend(load(db, userId), now);
  if (!result.ok) {
    throw new HttpError(429, "Limite de envios desta sessão atingido. Aguarde o fim da pausa para enviar novamente.", {
      quota: viewQuota(result.state, now),
    });
  }
  save(db, userId, result.state, now);
  return { messageType: result.messageType, quota: viewQuota(result.state, now) };
}
