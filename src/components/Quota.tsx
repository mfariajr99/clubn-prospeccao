import { Clock3, Lock, Send } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QUOTA_SESSIONS, formatCountdown, registerSend, viewQuota, type QuotaView } from "../../shared/sendQuota";
import { api } from "../lib/api";
import { useSession } from "./Session";

interface QuotaValue {
  quota: QuotaView | null;
  /** Milliseconds until sending is released (0 when not paused). */
  remainingMs: number;
  lockedReason: string | null;
  nextMessageType: number;
  apply: (quota: QuotaView) => void;
  /** Optimistic local count right after a click (the server confirms it). */
  countLocal: () => void;
  refresh: () => void;
}

const QuotaContext = createContext<QuotaValue>({
  quota: null,
  remainingMs: 0,
  lockedReason: null,
  nextMessageType: 1,
  apply: () => undefined,
  countLocal: () => undefined,
  refresh: () => undefined,
});

export function QuotaProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [quota, setQuota] = useState<QuotaView | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const offset = useRef(0); // server time - client time

  const apply = useCallback((q: QuotaView) => {
    offset.current = Date.parse(q.now) - Date.now();
    setQuota(q);
  }, []);

  const refresh = useCallback(() => {
    if (!user) return;
    api
      .get<QuotaView>("/quota")
      .then(apply)
      .catch(() => undefined);
  }, [user, apply]);

  useEffect(() => {
    setQuota(null);
    refresh();
    const poll = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(poll);
  }, [refresh]);

  const lockedUntil = quota?.lockedUntil ? Date.parse(quota.lockedUntil) : 0;
  useEffect(() => {
    if (!lockedUntil) return;
    const t = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [lockedUntil]);

  const remainingMs = lockedUntil ? Math.max(0, lockedUntil - (clock + offset.current)) : 0;
  // Pause finished: ask the server for the new session.
  useEffect(() => {
    if (lockedUntil && remainingMs === 0) refresh();
  }, [lockedUntil, remainingMs, refresh]);

  const countLocal = useCallback(() => {
    setQuota((q) => {
      if (!q) return q;
      const now = new Date(Date.now() + offset.current);
      const r = registerSend(q, now);
      return r.ok ? viewQuota(r.state, now) : q;
    });
  }, []);

  const value = useMemo<QuotaValue>(
    () => ({
      quota,
      remainingMs,
      lockedReason: quota?.locked && remainingMs > 0 ? `Pausa de envios: libera em ${formatCountdown(remainingMs)}` : null,
      nextMessageType: quota?.nextMessageType ?? 1,
      apply,
      countLocal,
      refresh,
    }),
    [quota, remainingMs, apply, countLocal, refresh],
  );
  return <QuotaContext.Provider value={value}>{children}</QuotaContext.Provider>;
}

export const useQuota = () => useContext(QuotaContext);

/** Test helper: provides a fixed quota state. */
export const QuotaContextForTests = ({ value, children }: { value: QuotaValue; children: ReactNode }) => <QuotaContext.Provider value={value}>{children}</QuotaContext.Provider>;

/** Header counter: session, session progress, daily total and pause countdown. */
export function QuotaBadge() {
  const { quota, remainingMs, lockedReason } = useQuota();
  if (!quota) return null;
  const locked = Boolean(lockedReason);
  const lastSession = quota.sessionIndex === QUOTA_SESSIONS.length - 1;
  const title = locked
    ? `${lastSession ? "Limite diário de 90 envios atingido" : `Sessão ${quota.session} concluída`}. Envios liberados às ${new Date(Date.parse(quota.lockedUntil!)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
    : `Sessão ${quota.session} de ${QUOTA_SESSIONS.length}: ${quota.sessionCount} de ${quota.sessionLimit} envios. Hoje: ${quota.totalCount} de ${quota.dailyLimit}. Próxima mensagem: tipo ${quota.nextMessageType}.`;
  return (
    <div className={`quota-badge ${locked ? "locked" : ""}`} role="status" aria-live={locked ? "off" : "polite"} title={title} data-testid="quota-badge">
      {locked ? <Lock size={15} aria-hidden /> : <Send size={15} aria-hidden />}
      {locked ? (
        <span className="qb-main">
          <Clock3 size={13} aria-hidden /> <strong className="mono">{formatCountdown(remainingMs)}</strong>
          <span className="qb-sub">{lastSession ? "limite diário" : `pausa · sessão ${quota.session + 1}`}</span>
        </span>
      ) : (
        <span className="qb-main">
          <strong className="mono">
            {quota.sessionCount}/{quota.sessionLimit}
          </strong>
          <span className="qb-sub">sessão {quota.session}/{QUOTA_SESSIONS.length}</span>
        </span>
      )}
      <span className="qb-day mono">
        {quota.totalCount}/{quota.dailyLimit}
        <span className="qb-sub">hoje</span>
      </span>
    </div>
  );
}
