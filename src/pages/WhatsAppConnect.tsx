import { CheckCircle2, KeyRound, Loader2, LogOut, QrCode, RefreshCw, ShieldAlert, Smartphone } from "lucide-react";
import { useState } from "react";
import type { WhatsAppStatus } from "../../shared/types";
import { useSession } from "../components/Session";
import { useToast } from "../components/Toast";
import { formatPhone, useWhatsApp } from "../components/WhatsAppStatus";
import { ConfirmDialog, Field, SkeletonRows } from "../components/ui";
import { ApiError, api, errorMessage } from "../lib/api";

type Method = "qr" | "code";

export default function WhatsAppConnect() {
  const { user } = useSession();
  const { status, apply, refresh } = useWhatsApp();
  const toast = useToast();
  const [method, setMethod] = useState<Method>("qr");
  const [phone, setPhone] = useState("55 ");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  if (!status) return <SkeletonRows rows={4} height={70} />;

  const start = async () => {
    setPhoneError(null);
    if (method === "code" && phone.replace(/\D/g, "").length < 12) {
      setPhoneError("Informe o número com DDI e DDD, ex.: 55 11 91234-5678.");
      return;
    }
    setBusy(true);
    try {
      apply(await api.post<WhatsAppStatus>("/whatsapp/connect", method === "code" ? { method, phone } : { method }));
    } catch (e) {
      if (e instanceof ApiError && e.fields.phone) setPhoneError(e.message);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      apply(await api.post<WhatsAppStatus>("/whatsapp/disconnect"));
      setConfirmOff(false);
      toast.show("WhatsApp desconectado deste operador.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const simulateLink = async () => {
    try {
      apply(await api.post<WhatsAppStatus>("/whatsapp/simulate-link"));
      toast.success("Conexão simulada concluída.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const waiting = ["connecting", "qr", "pairing"].includes(status.state);
  const connected = status.state === "connected";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conexão WhatsApp</h1>
          <p>
            Conecte o WhatsApp de <strong>{user?.name ?? "operador"}</strong> para enviar as mensagens das campanhas direto pelo sistema: cada clique em “Enviar mensagem” envia uma
            mensagem. Cada operador conecta o próprio número.
          </p>
        </div>
      </div>

      {status.simulated && (
        <div className="notice" role="note" style={{ marginBottom: 14 }}>
          <Smartphone size={16} />
          <span>Demonstração: a conexão é simulada e nenhuma mensagem é enviada de verdade.</span>
        </div>
      )}

      <div className="notice warning" role="note" style={{ marginBottom: 18 }}>
        <ShieldAlert size={16} />
        <span>
          Conexão própria, sem a API oficial da Meta (funciona como o WhatsApp Web). O WhatsApp pode restringir ou banir números que enviam muitas mensagens para quem não tem o seu
          contato — por isso as sessões e pausas (30/15/30/15, até 90 por dia) continuam valendo. Prefira um número dedicado à prospecção.
        </span>
      </div>

      {connected ? (
        <section className="card wa-connected" aria-label="WhatsApp conectado">
          <div className="wa-connected-head">
            <span className="wa-big-icon on">
              <CheckCircle2 size={26} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0 }}>WhatsApp conectado</h2>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                <strong className="mono">{formatPhone(status.phone)}</strong>
                {status.name ? ` · ${status.name}` : ""} · operador {user?.name}
              </p>
            </div>
          </div>
          <p style={{ margin: "14px 0" }}>
            Pronto: em <strong>Iniciar campanhas</strong>, o botão “Enviar mensagem” envia direto por este número, alternando as mensagens 1 → 2 → 3 e marcando o contato como
            “Mensagem enviada”.
          </p>
          <div className="btn-row">
            <button className="btn secondary danger-text" onClick={() => setConfirmOff(true)} disabled={busy}>
              <LogOut size={16} /> Desconectar
            </button>
          </div>
        </section>
      ) : (
        <section className="card" aria-label="Conectar WhatsApp">
          <div className="tabs" role="tablist" aria-label="Forma de conexão">
            <button role="tab" aria-selected={method === "qr"} className={`tab ${method === "qr" ? "active" : ""}`} onClick={() => setMethod("qr")} disabled={waiting}>
              <QrCode size={16} /> QR Code
            </button>
            <button role="tab" aria-selected={method === "code"} className={`tab ${method === "code" ? "active" : ""}`} onClick={() => setMethod("code")} disabled={waiting}>
              <KeyRound size={16} /> Código de conexão
            </button>
          </div>

          <div className="wa-connect-grid">
            <ol className="wa-steps">
              <li>Abra o WhatsApp no celular do operador.</li>
              <li>
                Toque em <strong>Mais opções ⋮</strong> (Android) ou <strong>Configurações</strong> (iPhone).
              </li>
              <li>
                Toque em <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong>.
              </li>
              {method === "qr" ? (
                <li>Aponte a câmera para o QR Code ao lado.</li>
              ) : (
                <li>
                  Toque em <strong>Conectar com número de telefone</strong> e digite o código que aparece ao lado.
                </li>
              )}
            </ol>

            <div className="wa-connect-box">
              {status.state === "qr" && status.qr && (
                <>
                  <img src={status.qr} alt="QR Code para conectar o WhatsApp" className="wa-qr" width={240} height={240} data-testid="wa-qr" />
                  <p className="small muted">O QR Code muda a cada poucos segundos. Mantenha esta tela aberta.</p>
                </>
              )}
              {status.state === "pairing" && status.pairing_code && (
                <>
                  <div className="wa-code mono" data-testid="wa-pairing-code">
                    {status.pairing_code}
                  </div>
                  <p className="small muted">Digite este código no celular. Ele vale por alguns minutos.</p>
                </>
              )}
              {status.state === "connecting" && (
                <div className="wa-waiting">
                  <Loader2 size={28} className="spin" />
                  <span>Preparando a conexão…</span>
                </div>
              )}
              {status.state === "disconnected" && (
                <>
                  {method === "code" && (
                    <Field label="Número do WhatsApp (com DDI e DDD)" htmlFor="wa-phone" error={phoneError ?? undefined} hint="Ex.: 55 11 91234-5678">
                      <input id="wa-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
                    </Field>
                  )}
                  <button className="btn" onClick={start} disabled={busy}>
                    {busy ? <Loader2 size={16} className="spin" /> : method === "qr" ? <QrCode size={16} /> : <KeyRound size={16} />}{" "}
                    {method === "qr" ? "Gerar QR Code" : "Gerar código de conexão"}
                  </button>
                </>
              )}
              {status.error && status.state === "disconnected" && (
                <div className="notice danger" role="alert" style={{ marginTop: 12 }}>
                  {status.error}
                </div>
              )}
              {waiting && (
                <div className="btn-row" style={{ justifyContent: "center", marginTop: 8 }}>
                  <button className="btn secondary sm" onClick={stop} disabled={busy}>
                    Cancelar
                  </button>
                  <button className="btn secondary sm" onClick={refresh}>
                    <RefreshCw size={14} /> Atualizar
                  </button>
                  {status.simulated && (
                    <button className="btn sm" onClick={simulateLink}>
                      Simular leitura no celular
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmOff}
        title="Desconectar o WhatsApp?"
        message={`Os envios de ${user?.name ?? "este operador"} voltam a abrir o WhatsApp do aparelho (wa.me) até você conectar de novo.`}
        confirmLabel="Desconectar"
        danger
        busy={busy}
        onCancel={() => setConfirmOff(false)}
        onConfirm={stop}
      />
    </>
  );
}
