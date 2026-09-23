// Per-operator sending discipline (to reduce the risk of WhatsApp blocks).
// Each click on "Enviar mensagem" counts as one send. Cycle of 24 hours:
//   Sessão 1: 30 envios → pausa de 90 min
//   Sessão 2: 15 envios → pausa de 90 min
//   Sessão 3: 30 envios → pausa de 120 min
//   Sessão 4: 15 envios → total 90; pausa até completar 24 h do início do ciclo
// Then the cycle restarts at Sessão 1. Messages rotate 1 → 2 → 3 → 1 …
// Pure functions: used by the server (enforcement) and the client (display).

export interface QuotaSession {
  limit: number;
  /** Pause after the session, in minutes. null = until the 24h cycle ends. */
  pauseMinutes: number | null;
}

export const QUOTA_SESSIONS: QuotaSession[] = [
  { limit: 30, pauseMinutes: 90 },
  { limit: 15, pauseMinutes: 90 },
  { limit: 30, pauseMinutes: 120 },
  { limit: 15, pauseMinutes: null },
];
export const DAILY_LIMIT = QUOTA_SESSIONS.reduce((a, s) => a + s.limit, 0); // 90
export const CYCLE_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_TYPES = 3;

export interface QuotaState {
  cycleStartedAt: string | null;
  sessionIndex: number; // 0..3
  sessionCount: number;
  totalCount: number;
  lockedUntil: string | null;
}

export interface QuotaView extends QuotaState {
  session: number; // 1..4
  sessionLimit: number;
  dailyLimit: number;
  locked: boolean;
  /** Message type (1, 2 or 3) that the next click will use. */
  nextMessageType: number;
  cycleEndsAt: string | null;
  now: string;
}

export const emptyQuota = (): QuotaState => ({ cycleStartedAt: null, sessionIndex: 0, sessionCount: 0, totalCount: 0, lockedUntil: null });

/** Applies expired pauses and the 24h cycle reset. */
export function normalizeQuota(state: QuotaState, now: Date): QuotaState {
  let s = { ...state };
  const t = now.getTime();
  if (s.lockedUntil && t >= Date.parse(s.lockedUntil)) {
    const lastSession = s.sessionIndex >= QUOTA_SESSIONS.length - 1;
    s = lastSession ? emptyQuota() : { ...s, sessionIndex: s.sessionIndex + 1, sessionCount: 0, lockedUntil: null };
  }
  if (!s.lockedUntil && s.cycleStartedAt && t >= Date.parse(s.cycleStartedAt) + CYCLE_MS) s = emptyQuota();
  return s;
}

export function viewQuota(state: QuotaState, now: Date): QuotaView {
  const s = normalizeQuota(state, now);
  return {
    ...s,
    session: s.sessionIndex + 1,
    sessionLimit: QUOTA_SESSIONS[s.sessionIndex].limit,
    dailyLimit: DAILY_LIMIT,
    locked: Boolean(s.lockedUntil),
    nextMessageType: (s.totalCount % MESSAGE_TYPES) + 1,
    cycleEndsAt: s.cycleStartedAt ? new Date(Date.parse(s.cycleStartedAt) + CYCLE_MS).toISOString() : null,
    now: now.toISOString(),
  };
}

export type RegisterResult = { ok: true; state: QuotaState; messageType: number } | { ok: false; state: QuotaState };

/** Counts one send. Returns ok:false (nothing counted) while paused. */
export function registerSend(state: QuotaState, now: Date): RegisterResult {
  const s = normalizeQuota(state, now);
  if (s.lockedUntil) return { ok: false, state: s };
  const messageType = (s.totalCount % MESSAGE_TYPES) + 1;
  const cycleStartedAt = s.cycleStartedAt ?? now.toISOString();
  const next: QuotaState = { ...s, cycleStartedAt, sessionCount: s.sessionCount + 1, totalCount: s.totalCount + 1 };
  const session = QUOTA_SESSIONS[next.sessionIndex];
  if (next.sessionCount >= session.limit) {
    const until =
      session.pauseMinutes === null
        ? Math.max(Date.parse(cycleStartedAt) + CYCLE_MS, now.getTime())
        : now.getTime() + session.pauseMinutes * 60_000;
    next.lockedUntil = new Date(until).toISOString();
  }
  return { ok: true, state: next, messageType };
}

/** "01:29:59" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}
