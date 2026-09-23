import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { EDITABLE_CAMPAIGN_STATUSES } from "../../shared/constants";
import { findUnknownVariables } from "../../shared/template";
import type { Campaign, Lead, Paginated } from "../../shared/types";
import { cleanFilter } from "../components/AddToCampaignDialog";
import type { LeadFilterValues } from "../components/LeadFilters";
import { LeadPicker, emptySelection, selectionCount, type PickerSelection } from "../components/LeadPicker";
import { MessageComposer } from "../components/MessageComposer";
import { useToast } from "../components/Toast";
import { CampaignBadge, Field, SkeletonRows } from "../components/ui";
import { ApiError, api, errorMessage } from "../lib/api";
import { fmtNumber } from "../lib/format";

const DEFAULT_MESSAGES = [
  "Olá, {{nome_estabelecimento}}! Tudo bem? Sou do Club’n e conheci o trabalho de vocês em {{cidade}}. Temos um programa de parcerias para {{segmento}} que pode trazer novos clientes. Podemos conversar?",
  "Oi, {{nome_estabelecimento}}! Aqui é do Club’n. Estamos selecionando parceiros de {{segmento}} em {{cidade}} e lembramos de vocês. Posso te explicar em 2 minutos?",
  "Bom dia, {{nome_estabelecimento}}! O Club’n conecta estabelecimentos de {{cidade}} a clientes do nosso clube de benefícios. Faz sentido conversarmos sobre uma parceria?",
];

export default function CampaignForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const [search] = useSearchParams();
  const state = (location.state ?? {}) as { leadIds?: number[]; filter?: LeadFilterValues };
  const batchId = search.get("batch_id");

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(editing);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [messages, setMessages] = useState<string[]>(DEFAULT_MESSAGES);
  const [messageTab, setMessageTab] = useState(0);
  const setMessage = (i: number, v: string) => setMessages((m) => m.map((x, j) => (j === i ? v : x)));
  const [status, setStatus] = useState<"draft" | "ready">("draft");
  const [filter, setFilter] = useState<LeadFilterValues>(() => state.filter ?? (batchId ? { batch_id: batchId } : {}));
  const [selection, setSelection] = useState<PickerSelection>(emptySelection);
  const [pageLeads, setPageLeads] = useState<Lead[]>([]);
  const [previewLeadId, setPreviewLeadId] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ name?: string; messages?: (string | undefined)[]; leads?: string }>({});
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  // Pre-selection coming from the lead list / import result.
  useEffect(() => {
    if (editing) return;
    if (state.leadIds?.length) {
      setSelection({ mode: "ids", ids: new Set(state.leadIds), leads: new Map() });
    } else if (state.filter || batchId) {
      const f = state.filter ?? { batch_id: batchId ?? undefined };
      api
        .get<Paginated<Lead>>("/leads", { ...f, pageSize: 1 })
        .then((r) => setSelection({ mode: "filter", filter: f, total: r.total }))
        .catch(() => undefined);
      if (batchId && !name) setName(`Campanha do lote #${batchId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!id) return;
    api
      .get<Campaign>(`/campaigns/${id}`)
      .then((c) => {
        setCampaign(c);
        setName(c.name);
        setDescription(c.description);
        setMessages([c.message_template, c.message_template_2 || c.message_template, c.message_template_3 || c.message_template]);
        setStatus(c.status === "ready" ? "ready" : "draft");
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id, toast]);

  const previewLeads = useMemo(() => {
    const map = new Map<number, Lead>();
    if (selection.mode === "ids") selection.leads.forEach((l, k) => map.set(k, l));
    pageLeads.forEach((l) => map.set(l.id, l));
    return [...map.values()];
  }, [selection, pageLeads]);


  const newCount = selectionCount(selection);
  const totalLeads = (campaign?.lead_count ?? 0) + newCount;
  const locked = campaign && !EDITABLE_CAMPAIGN_STATUSES.includes(campaign.status);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    const next: typeof errors = {};
    if (name.trim().length < 3) next.name = "Informe o nome da campanha (mínimo 3 caracteres).";
    const messageErrors = messages.map((m, i) => {
      const unknown = findUnknownVariables(m);
      if (m.trim().length < 5) return `Escreva a mensagem ${i + 1}.`;
      if (unknown.length) return `Variáveis desconhecidas: ${unknown.map((u) => `{{${u}}}`).join(", ")}.`;
      if (messages.some((other, j) => j < i && other.trim() === m.trim())) return "Use um texto diferente das outras mensagens.";
      return undefined;
    });
    if (messageErrors.some(Boolean)) {
      next.messages = messageErrors;
      setMessageTab(messageErrors.findIndex(Boolean));
    }
    if (status === "ready" && totalLeads === 0) next.leads = "Selecione ao menos um lead para deixar a campanha pronta para iniciar.";
    setErrors(next);
    if (Object.keys(next).length) {
      toast.error("Verifique os campos destacados.");
      return;
    }
    submitting.current = true;
    setSaving(true);
    const body = {
      name,
      description,
      message_template: messages[0],
      message_template_2: messages[1],
      message_template_3: messages[2],
      status,
      lead_ids: selection.mode === "ids" && selection.ids.size ? [...selection.ids] : undefined,
      lead_filter: selection.mode === "filter" ? cleanFilter(selection.filter) : undefined,
    };
    try {
      const saved = editing ? await api.put<Campaign>(`/campaigns/${id}`, body) : await api.post<Campaign>("/campaigns", body);
      toast.success(editing ? "Campanha atualizada." : `Campanha criada com ${fmtNumber(saved.lead_count)} lead(s).`);
      navigate(`/campanhas/${saved.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={8} />;
  if (locked && campaign) {
    return (
      <div className="card">
        <h2>Esta campanha não pode ser editada</h2>
        <p className="muted">
          Status atual: <CampaignBadge status={campaign.status} />. Pause a campanha para editar ou duplique-a para criar uma nova versão.
        </p>
        <Link className="btn" to={`/campanhas/${campaign.id}`}>
          Voltar para a campanha
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="page-head">
        <div>
          <div className="breadcrumb">
            <Link to="/campanhas">Campanhas</Link> / {editing ? "Editar" : "Criar"}
          </div>
          <h1>{editing ? "Editar campanha" : "Criar campanha"}</h1>
          <p>Defina as 3 mensagens e selecione os leads. As mensagens serão abertas uma a uma no WhatsApp, sempre por clique do operador.</p>
        </div>
      </div>

      <section className="card">
        <h2>Dados da campanha</h2>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <Field label="Nome da campanha" required error={errors.name} htmlFor="campaign-name">
            <input id="campaign-name" className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Parceiros gastronomia — zona sul" />
          </Field>
          <Field label="Status" htmlFor="campaign-status" hint={campaign?.status === "paused" ? "Campanha pausada: o status será mantido." : "“Pronta para iniciar” libera a campanha na tela Iniciar campanhas."}>
            <select id="campaign-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as "draft" | "ready")} disabled={campaign?.status === "paused"}>
              <option value="draft">Rascunho</option>
              <option value="ready">Pronta para iniciar</option>
            </select>
          </Field>
          <Field label="Descrição" className="full" htmlFor="campaign-description">
            <textarea id="campaign-description" className="textarea" style={{ minHeight: 80 }} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Objetivo, público e observações internas." />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Mensagens</h2>
        <p className="card-sub">
          Escreva 3 versões da mensagem. A cada clique em “Enviar mensagem” o sistema alterna entre elas (1 → 2 → 3), o que reduz o risco de bloqueio no WhatsApp. Use variáveis para personalizar.
        </p>
        <div className="tabs" role="tablist" aria-label="Mensagens da campanha">
          {messages.map((_m, i) => (
            <button key={i} type="button" role="tab" aria-selected={messageTab === i} onClick={() => setMessageTab(i)}>
              Mensagem {i + 1}
              {errors.messages?.[i] ? " ⚠" : ""}
            </button>
          ))}
        </div>
        <MessageComposer
          key={messageTab}
          id={`campaign-message-${messageTab + 1}`}
          label={`Mensagem ${messageTab + 1} do WhatsApp`}
          value={messages[messageTab]}
          onChange={(v) => setMessage(messageTab, v)}
          error={errors.messages?.[messageTab]}
          previewLeads={previewLeads}
          previewLeadId={previewLeadId}
          onPreviewLeadChange={setPreviewLeadId}
        />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>{editing ? "Adicionar leads" : "Selecionar leads"}</h2>
            <p className="card-sub" style={{ margin: 0 }}>
              Filtre por segmento, bairro, cidade, estado, status, lote de importação ou potencial.
              {editing && ` A campanha já possui ${fmtNumber(campaign?.lead_count)} lead(s); a lista mostra apenas os que ainda não fazem parte dela.`}
            </p>
          </div>
          <span className="badge navy">{fmtNumber(newCount)} selecionado(s)</span>
        </div>
        {errors.leads && (
          <div className="notice danger" role="alert" style={{ marginBottom: 12 }}>
            {errors.leads}
          </div>
        )}
        <LeadPicker value={selection} onChange={setSelection} filter={filter} onFilterChange={setFilter} excludeCampaignId={editing ? Number(id) : undefined} onPageLeads={setPageLeads} />
      </section>

      <div className="form-actions" style={{ position: "sticky", bottom: 12, background: "var(--bg)", padding: "10px 0" }}>
        <button type="button" className="btn secondary" onClick={() => navigate(-1)} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Salvando…" : editing ? "Salvar campanha" : "Criar campanha"}
        </button>
      </div>
    </form>
  );
}
