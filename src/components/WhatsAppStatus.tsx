import { Smartphone } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { WhatsAppStatus } from "../../shared/types";
import { api } from "../lib/api";
import { useSession } from "./Session";

interface WhatsAppValue {
  status: WhatsAppStatus | null;
  connected: boolean;
  /** Unread messages in "Mensagens" for the selected operator. */
  unread: number;
  refreshUnread: () => void;
  refresh: () => void;
  apply: (s: WhatsAppStatus) => void;
}

const WhatsAppContext = createContext<WhatsAppValue>({ status: null, connected: false, unread: 0, refreshUnread: () => undefined, refresh: () => undefined, apply: () => undefined });

/** Connection of the SELECTED operator (each operator links their own number). */
export function WhatsAppProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);

  const refresh = useCallback(() => {
    if (!user) return;
    api
      .get<WhatsAppStatus>("/whatsapp/status")
      .then(setStatus)
      .catch(() => undefined); // older server or offline: keeps the wa.me flow
  }, [user]);

  useEffect(() => {
    setStatus(null);
    refresh();
  }, [refresh]);

  const waiting = status ? ["connecting", "qr", "pairing"].includes(status.state) : false;
  useEffect(() => {
    const t = window.setInterval(refresh, waiting ? 2000 : 30_000);
    return () => window.clearInterval(t);
  }, [refresh, waiting]);

  const [unread, setUnread] = useState(0);
  const refreshUnread = useCallback(() => {
    if (!user) return;
    api
      .get<{ unread: number }>("/inbox/unread")
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, [user]);
  const connected = status?.state === "connected";
  useEffect(() => {
    setUnread(0);
    refreshUnread();
    if (!connected) return;
    const t = window.setInterval(refreshUnread, 15_000);
    return () => window.clearInterval(t);
  }, [refreshUnread, connected]);

  const value = useMemo<WhatsAppValue>(
    () => ({ status, connected, unread, refreshUnread, refresh, apply: setStatus }),
    [status, connected, unread, refreshUnread, refresh],
  );
  return <WhatsAppContext.Provider value={value}>{children}</WhatsAppContext.Provider>;
}

export const useWhatsApp = () => useContext(WhatsAppContext);
export const WhatsAppContextForTests = WhatsAppContext.Provider;

export function formatPhone(digits: string | null | undefined) {
  if (!digits) return "";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${digits}`;
}

/** Header indicator: connected number, or a shortcut to connect. */
export function WhatsAppPill() {
  const { status } = useWhatsApp();
  if (!status) return null;
  const connected = status.state === "connected";
  const waiting = ["connecting", "qr", "pairing"].includes(status.state);
  const label = connected ? "WhatsApp conectado" : waiting ? "Conectando WhatsApp…" : "WhatsApp desconectado";
  return (
    <Link
      to="/whatsapp"
      className={`wa-pill ${connected ? "on" : waiting ? "wait" : "off"}`}
      title={connected ? `${label}: ${formatPhone(status.phone)}${status.simulated ? " (simulado)" : ""}` : `${label}. Clique para conectar.`}
      aria-label={label}
      data-testid="wa-pill"
    >
      <span className="wa-dot" aria-hidden />
      <Smartphone size={15} aria-hidden />
      <span className="wa-pill-text">{connected ? formatPhone(status.phone) : waiting ? "Conectando…" : "Conectar"}</span>
    </Link>
  );
}
