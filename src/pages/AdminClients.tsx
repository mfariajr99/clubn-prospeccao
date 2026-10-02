import { Megaphone, MessageCircle, Plus, Send, Sparkles, UserCog, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DAILY_LIMIT } from "../../shared/sendQuota";
import type { ClientAccountSummary } from "../../shared/types";
import { CredentialsBox, PasswordInput, generatePassword } from "../components/ClientAccess";
import { useToast } from "../components/Toast";
import { EmptyState, Field, Modal, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { ApiError, api, errorMessage } from "../lib/api";
import { fmtDateTime, fmtNumber } from "../lib/format";

export function AccountBadge({ active }: { active: boolean }) {
  return (
    <span className={`badge ${active ? "success" : "danger"}`}>
      <span className="dot" aria-hidden />
      {active ? "Ativo" : "Bloqueado"}
    </span>
  );
}

export function MiniStat({ icon, label, value, caption }: { icon: ReactNode; label: string; value: number | string; caption?: string }) {
  return (
    <div className="stat">
      <div className="stat-head">
        <span className="stat-icon">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value mono">{typeof value === "number" ? fmtNumber(value) : value}</div>
      {caption && <div className="stat-caption">{caption}</div>}
    </div>
  );
}

const suggestLogin = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);

function NewClientModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [loginTouched, setLoginTouched] = useState(false);
  const [password, setPassword] = useState(generatePassword);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; login: string; password: string } | null>(null);

  const close = () => {
    setName("");
    setLogin("");
    setLoginTouched(false);
    setPassword(generatePassword());
    setErrors({});
    setCreated(null);
    onClose();
  };

  const submit = async () => {
    const local: Record<string, string> = {};
    if (name.trim().length < 2) local.name = "Informe o nome (mínimo 2 caracteres).";
    if (!/^[a-z0-9][a-z0-9._@-]{2,59}$/.test(login.trim().toLowerCase())) local.login = "Use de 3 a 60 caracteres: letras, números, ponto, hífen, _ ou @ (sem espaços).";
    if (password.length < 8) local.password = "Mínimo de 8 caracteres.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const account = await api.post<ClientAccountSummary>("/admin/clients", { name: name.trim(), login: login.trim(), password });
      setCreated({ name: account.name, login: account.login, password });
      toast.success(`Usuário ${account.name} criado.`);
      onCreated();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={created ? "Usuário criado" : "Novo usuário"}
      description={created ? undefined : "O novo usuário entra com o próprio login e senha, começa do zero e só vê os dados dele. Ele não pode criar outros logins."}
      onClose={close}
      actions={
        created ? (
          <button className="btn" onClick={close}>
            Concluir
          </button>
        ) : (
          <>
            <button className="btn secondary" onClick={close} disabled={busy}>
              Cancelar
            </button>
            <button className="btn" onClick={submit} disabled={busy}>
              {busy ? "Criando…" : "Criar usuário"}
            </button>
          </>
        )
      }
    >
      {created ? (
        <CredentialsBox {...created} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Nome do cliente" required htmlFor="client-name" error={errors.name} hint="Empresa ou pessoa. Aparece no topo do sistema do cliente.">
            <input
              id="client-name"
              className="input"
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
                if (!loginTouched) setLogin(suggestLogin(e.target.value));
              }}
            />
          </Field>
          <Field label="Login" required htmlFor="client-login" error={errors.login} hint="Sem espaços. Ex.: agencia.exemplo">
            <input
              id="client-login"
              className="input"
              value={login}
              maxLength={60}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => {
                setLoginTouched(true);
                setLogin(e.target.value.toLowerCase().replace(/\s+/g, ""));
              }}
            />
          </Field>
          <Field label="Senha" required htmlFor="client-password" error={errors.password} hint="Mínimo de 8 caracteres. Use “Gerar” para uma senha forte.">
            <PasswordInput id="client-password" value={password} onChange={setPassword} invalid={Boolean(errors.password)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

export default function AdminClients() {
  const { data, loading, error, reload } = useAsync((s) => api.get<ClientAccountSummary[]>("/admin/clients", undefined, s), []);
  const [creating, setCreating] = useState(false);
  const list = data ?? [];
  const sum = (k: keyof ClientAccountSummary["metrics"]) => list.reduce((t, c) => t + (Number(c.metrics[k]) || 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Novos usuários</h1>
          <p>Crie logins para clientes independentes. Cada um tem a própria base, começa do zero e só vê os próprios dados. Aqui você acompanha apenas os números.</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => setCreating(true)}>
            <Plus size={16} /> Novo usuário
          </button>
        </div>
      </div>

      {error && <div className="notice danger">{error}</div>}
      {loading && !data ? (
        <SkeletonRows rows={4} height={70} />
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<UserCog size={28} />}
            title="Nenhum usuário criado"
            description="Crie o primeiro login para um cliente. Ele recebe um sistema vazio para criar as próprias campanhas."
            action={
              <button className="btn sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> Novo usuário
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <MiniStat icon={<Users size={19} />} label="Usuários ativos" value={list.filter((c) => c.active).length} caption={`${fmtNumber(list.length)} no total`} />
            <MiniStat icon={<Megaphone size={19} />} label="Campanhas em andamento" value={sum("campaigns_in_progress")} caption={`${fmtNumber(sum("campaigns"))} campanhas criadas`} />
            <MiniStat icon={<MessageCircle size={19} />} label="WhatsApp abertos" value={sum("whatsapp_opened")} caption={`${fmtNumber(sum("sends_today"))} hoje`} />
            <MiniStat icon={<Sparkles size={19} />} label="Interessados" value={sum("interested")} caption={`${fmtNumber(sum("partnerships"))} parcerias`} />
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="list-view">
              <div className="table-wrap responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>Leads</th>
                      <th>Campanhas ativas</th>
                      <th>WhatsApp abertos</th>
                      <th>Interessados</th>
                      <th>Envios hoje</th>
                      <th>Último acesso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id}>
                        <td className="col-main">
                          <Link to={`/usuarios/${c.id}`} className="cell-title">
                            {c.name}
                          </Link>
                          <div className="cell-sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                            <AccountBadge active={c.active} /> <span className="mono">{c.login}</span>
                          </div>
                        </td>
                        <td className="mono">{fmtNumber(c.metrics.leads)}</td>
                        <td className="mono nowrap">
                          {fmtNumber(c.metrics.campaigns_in_progress)} <span className="muted">/ {fmtNumber(c.metrics.campaigns)}</span>
                        </td>
                        <td className="mono">{fmtNumber(c.metrics.whatsapp_opened)}</td>
                        <td className="mono">{fmtNumber(c.metrics.interested)}</td>
                        <td className="mono nowrap">
                          {fmtNumber(c.metrics.sends_today)}/{DAILY_LIMIT}
                        </td>
                        <td className="small">{c.last_login_at ? fmtDateTime(c.last_login_at) : "Nunca entrou"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cards-list">
                {list.map((c) => (
                  <article className="lead-card" key={c.id}>
                    <div className="lc-head">
                      <div style={{ minWidth: 0 }}>
                        <Link to={`/usuarios/${c.id}`} className="cell-title">
                          {c.name}
                        </Link>
                        <div className="cell-sub mono">{c.login}</div>
                      </div>
                      <AccountBadge active={c.active} />
                    </div>
                    <div className="client-figures">
                      <span>
                        <strong className="mono">{fmtNumber(c.metrics.leads)}</strong> leads
                      </span>
                      <span>
                        <strong className="mono">{fmtNumber(c.metrics.campaigns_in_progress)}</strong>/{fmtNumber(c.metrics.campaigns)} campanhas ativas
                      </span>
                      <span>
                        <strong className="mono">{fmtNumber(c.metrics.whatsapp_opened)}</strong> WhatsApp abertos
                      </span>
                      <span>
                        <strong className="mono">{fmtNumber(c.metrics.interested)}</strong> interessados
                      </span>
                      <span>
                        <Send size={12} aria-hidden /> <strong className="mono">{fmtNumber(c.metrics.sends_today)}</strong>/{DAILY_LIMIT} hoje
                      </span>
                    </div>
                    <div className="lc-meta">
                      <span>{c.last_login_at ? `Último acesso ${fmtDateTime(c.last_login_at)}` : "Nunca entrou"}</span>
                    </div>
                    <div className="lc-row-actions">
                      <Link className="btn secondary sm" to={`/usuarios/${c.id}`}>
                        Ver números
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      <NewClientModal open={creating} onClose={() => setCreating(false)} onCreated={reload} />
    </>
  );
}
