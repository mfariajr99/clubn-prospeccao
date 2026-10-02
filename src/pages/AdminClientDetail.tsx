import { ArrowLeft, KeyRound, Lock, LockOpen, Megaphone, MessageCircle, Send, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DAILY_LIMIT } from "../../shared/sendQuota";
import type { ClientAccountDetail } from "../../shared/types";
import { CredentialsBox, PasswordInput, generatePassword } from "../components/ClientAccess";
import { useToast } from "../components/Toast";
import { CampaignBadge, ConfirmDialog, EmptyState, Field, Modal, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { api, errorMessage } from "../lib/api";
import { fmtDate, fmtDateTime, fmtNumber, pct } from "../lib/format";
import { AccountBadge, MiniStat } from "./AdminClients";

export default function AdminClientDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data: c, loading, error, reload, setData } = useAsync((s) => api.get<ClientAccountDetail>(`/admin/clients/${id}`, undefined, s), [id]);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState(generatePassword);
  const [resetDone, setResetDone] = useState(false);

  if (loading && !c) return <SkeletonRows rows={6} height={80} />;
  if (error || !c) return <div className="notice danger">{error ?? "Usuário não encontrado."}</div>;

  const toggleActive = async () => {
    setBusy(true);
    try {
      const updated = await api.put<ClientAccountDetail>(`/admin/clients/${c.id}`, { active: !c.active });
      setData({ ...c, ...updated, campaigns: c.campaigns });
      toast.success(updated.active ? "Acesso liberado." : "Acesso bloqueado. O usuário foi desconectado.");
      setConfirmBlock(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (newPassword.length < 8) return toast.error("A senha precisa ter pelo menos 8 caracteres.");
    setBusy(true);
    try {
      await api.post(`/admin/clients/${c.id}/password`, { password: newPassword });
      setResetDone(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const closeReset = () => {
    setResetOpen(false);
    setResetDone(false);
    setNewPassword(generatePassword());
    reload();
  };

  const m = c.metrics;
  return (
    <>
      <Link to="/usuarios" className="back-link small">
        <ArrowLeft size={14} /> Novos usuários
      </Link>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {c.name} <AccountBadge active={c.active} />
          </h1>
          <p>
            Login <strong className="mono">{c.login}</strong> · criado em {fmtDate(c.created_at)} · {c.last_login_at ? `último acesso ${fmtDateTime(c.last_login_at)}` : "ainda não entrou"}
          </p>
        </div>
        <div className="btn-row">
          <button className="btn secondary" onClick={() => setResetOpen(true)}>
            <KeyRound size={16} /> Redefinir senha
          </button>
          {c.active ? (
            <button className="btn secondary danger-text" onClick={() => setConfirmBlock(true)}>
              <Lock size={16} /> Bloquear acesso
            </button>
          ) : (
            <button className="btn" onClick={toggleActive} disabled={busy}>
              <LockOpen size={16} /> Liberar acesso
            </button>
          )}
        </div>
      </div>

      <div className="notice" role="note" style={{ marginBottom: 18 }}>
        <ShieldCheck size={16} />
        <span>Por privacidade, aqui aparecem só os números. Nomes de leads, telefones e mensagens deste usuário ficam visíveis apenas para ele.</span>
      </div>

      <div className="stat-grid">
        <MiniStat icon={<Users size={19} />} label="Leads cadastrados" value={m.leads} caption={`${fmtNumber(m.contacted)} contatados`} />
        <MiniStat icon={<Megaphone size={19} />} label="Campanhas" value={m.campaigns} caption={`${fmtNumber(m.campaigns_in_progress)} em andamento`} />
        <MiniStat icon={<MessageCircle size={19} />} label="WhatsApp abertos" value={m.whatsapp_opened} caption={`${fmtNumber(m.replied)} responderam`} />
        <MiniStat icon={<Sparkles size={19} />} label="Interessados" value={m.interested} caption={`${fmtNumber(m.partnerships)} parcerias concluídas`} />
        <MiniStat icon={<Send size={19} />} label="Envios hoje" value={`${fmtNumber(m.sends_today)}/${DAILY_LIMIT}`} caption={m.last_activity_at ? `Última atividade ${fmtDateTime(m.last_activity_at)}` : "Sem atividade ainda"} />
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <h2>Campanhas</h2>
        <p className="card-sub">Números de cada campanha criada por este usuário.</p>
        {c.campaigns.length === 0 ? (
          <EmptyState title="Nenhuma campanha criada ainda" />
        ) : (
          <div className="list-view">
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Leads</th>
                    <th>WhatsApp abertos</th>
                    <th>Responderam</th>
                    <th>Interessados</th>
                    <th>Parcerias</th>
                    <th>Conversão</th>
                  </tr>
                </thead>
                <tbody>
                  {c.campaigns.map((k) => (
                    <tr key={k.id}>
                      <td className="col-main">
                        <span className="cell-title">{k.name}</span>
                        <div className="cell-sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                          <CampaignBadge status={k.status} /> Criada em {fmtDate(k.created_at)}
                        </div>
                      </td>
                      <td className="mono">{fmtNumber(k.total)}</td>
                      <td className="mono">{fmtNumber(k.whatsapp_opened)}</td>
                      <td className="mono">
                        {fmtNumber(k.replied)}
                        {k.not_interested > 0 && <div className="cell-sub">{fmtNumber(k.not_interested)} sem interesse</div>}
                      </td>
                      <td className="mono">{fmtNumber(k.interested)}</td>
                      <td className="mono">{fmtNumber(k.partnerships)}</td>
                      <td className="mono">{pct(k.interested, k.total)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cards-list">
              {c.campaigns.map((k) => (
                <article className="lead-card" key={k.id}>
                  <div className="lc-head">
                    <span className="cell-title">{k.name}</span>
                    <CampaignBadge status={k.status} />
                  </div>
                  <div className="client-figures">
                    <span>
                      <strong className="mono">{fmtNumber(k.total)}</strong> leads
                    </span>
                    <span>
                      <strong className="mono">{fmtNumber(k.whatsapp_opened)}</strong> WhatsApp abertos
                    </span>
                    <span>
                      <strong className="mono">{fmtNumber(k.replied)}</strong> responderam
                    </span>
                    <span>
                      <strong className="mono">{fmtNumber(k.interested)}</strong> interessados
                    </span>
                    <span>
                      <strong className="mono">{fmtNumber(k.partnerships)}</strong> parcerias
                    </span>
                    <span>
                      <strong className="mono">{pct(k.interested, k.total)}%</strong> conversão
                    </span>
                  </div>
                  <div className="lc-meta">
                    <span>Criada em {fmtDate(k.created_at)}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmBlock}
        title={`Bloquear o acesso de ${c.name}?`}
        message="O usuário é desconectado na hora e não consegue mais entrar. Os dados dele são mantidos e você pode liberar o acesso depois."
        confirmLabel="Bloquear acesso"
        danger
        busy={busy}
        onCancel={() => setConfirmBlock(false)}
        onConfirm={toggleActive}
      />

      <Modal
        open={resetOpen}
        title={resetDone ? "Senha redefinida" : "Redefinir senha"}
        description={resetDone ? undefined : "A senha antiga deixa de funcionar e o usuário é desconectado de todos os aparelhos."}
        onClose={closeReset}
        actions={
          resetDone ? (
            <button className="btn" onClick={closeReset}>
              Concluir
            </button>
          ) : (
            <>
              <button className="btn secondary" onClick={closeReset} disabled={busy}>
                Cancelar
              </button>
              <button className="btn" onClick={resetPassword} disabled={busy}>
                {busy ? "Salvando…" : "Salvar nova senha"}
              </button>
            </>
          )
        }
      >
        {resetDone ? (
          <CredentialsBox name={c.name} login={c.login} password={newPassword} />
        ) : (
          <Field label="Nova senha" required htmlFor="reset-password" hint="Mínimo de 8 caracteres.">
            <PasswordInput id="reset-password" value={newPassword} onChange={setNewPassword} />
          </Field>
        )}
      </Modal>
    </>
  );
}
