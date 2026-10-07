// Per-campaign dispatch rule and schedule (shared by API and client).

export interface CampaignRuleView {
  /** Max messages in the window (null = only the operator's daily sessions apply). */
  limit: number | null;
  window_hours: number | null;
  /** Messages already sent/opened inside the current window. */
  used: number;
  remaining: number | null;
  /** When the next message is released (only when the window is full). */
  next_slot_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  /** scheduled = before the start; ended = after the end; open = sending allowed by schedule. */
  phase: "scheduled" | "open" | "ended";
  /** Why sending is blocked by the campaign itself (schedule or rule), or null. */
  blocked_reason: string | null;
}

export const DEFAULT_SEND_LIMIT = 30;
export const DEFAULT_SEND_WINDOW_HOURS = 6;
export const MAX_SEND_LIMIT = 500;
export const MAX_SEND_WINDOW_HOURS = 168; // one week

// Messages are written by the server (UTC on Render): always show Brasília time.
const BR_TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export const fmtBrDateTime = (iso: string) => {
  const parts = Object.fromEntries(BR_TIME.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month} às ${parts.hour}:${parts.minute}`;
};
const fmt = fmtBrDateTime;

/**
 * Builds the rule view from the campaign settings and the send times inside the
 * window (ISO strings, oldest first).
 */
export function buildRuleView(
  campaign: { send_limit?: number | null; send_window_hours?: number | null; scheduled_start_at?: string | null; scheduled_end_at?: string | null },
  sendTimesInWindow: string[],
  now: Date,
): CampaignRuleView {
  const limit = campaign.send_limit ?? null;
  const windowHours = campaign.send_window_hours ?? null;
  const start = campaign.scheduled_start_at ?? null;
  const end = campaign.scheduled_end_at ?? null;
  const used = limit && windowHours ? sendTimesInWindow.length : 0;
  const remaining = limit && windowHours ? Math.max(0, limit - used) : null;
  let nextSlot: string | null = null;
  if (limit && windowHours && used >= limit) {
    const oldest = sendTimesInWindow[used - limit];
    nextSlot = new Date(Date.parse(oldest) + windowHours * 3600_000).toISOString();
  }
  const phase = start && Date.parse(start) > now.getTime() ? "scheduled" : end && Date.parse(end) <= now.getTime() ? "ended" : "open";
  const blocked =
    phase === "scheduled"
      ? `Campanha agendada: os envios começam em ${fmt(start!)}.`
      : phase === "ended"
        ? "O período agendado desta campanha terminou."
        : nextSlot
          ? `Regra da campanha atingida (${limit} mensagens a cada ${windowHours}h). Próximo envio liberado em ${fmt(nextSlot)}.`
          : null;
  return {
    limit,
    window_hours: windowHours,
    used,
    remaining,
    next_slot_at: nextSlot,
    scheduled_start_at: start,
    scheduled_end_at: end,
    phase,
    blocked_reason: blocked,
  };
}

/** "30 mensagens a cada 6 horas" */
export function describeRule(limit: number | null | undefined, windowHours: number | null | undefined): string {
  if (!limit || !windowHours) return "Sem regra própria (valem só as sessões do operador)";
  const w = windowHours === 24 ? "por dia" : windowHours % 24 === 0 ? `a cada ${windowHours / 24} dias` : `a cada ${windowHours} ${windowHours === 1 ? "hora" : "horas"}`;
  return `Até ${limit} ${limit === 1 ? "mensagem" : "mensagens"} ${w}`;
}

/** Goal: replies on at least 20% of the messages sent. */
export const REPLY_GOAL = 0.2;

/** Monday 00:00 to next Monday 00:00 in Brasília time (UTC-3, no daylight saving). */
export function brWeekRange(now: Date): { start: Date; end: Date } {
  const offsetMs = 3 * 3600_000;
  const local = new Date(now.getTime() - offsetMs); // Brasília wall clock as UTC fields
  const day = (local.getUTCDay() + 6) % 7; // 0 = Monday
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day);
  const start = new Date(startLocal + offsetMs);
  return { start, end: new Date(start.getTime() + 7 * 86400_000) };
}

/** How many messages the rule still allows until `until` (Infinity without a rule). */
export function ruleCapacity(rule: { limit: number | null; window_hours: number | null; remaining: number | null; next_slot_at: string | null }, from: Date, until: Date): number {
  if (!rule.limit || !rule.window_hours) return Number.POSITIVE_INFINITY;
  const hours = Math.max(0, (until.getTime() - from.getTime()) / 3600_000);
  if (hours <= 0) return 0;
  // what is left in the current window + full windows after it
  return (rule.remaining ?? 0) + Math.floor(hours / rule.window_hours) * rule.limit;
}
