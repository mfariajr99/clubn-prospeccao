import { ExternalLink, Eye, ListChecks, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CONTACT_STATUSES, CONTACT_STATUS_LABELS, type ContactStatus } from "../../shared/constants";
import type { Campaign, CampaignLead, Paginated } from "../../shared/types";
import { useAsync } from "../hooks/useAsync";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, fmtNumber, fmtPhone } from "../lib/format";
import { ContactStatusDialog } from "./ContactStatusDialog";
import { LeadPicker, emptySelection, selectionCount, type PickerSelection } from "./LeadPicker";
import type { LeadFilterValues } from "./LeadFilters";
import { cleanFilter } from "./AddToCampaignDialog";
import { ExternalLink2, PresenceCell } from "./Presence";
import { PreviewPanel } from "./PreviewPanel";
import { useToast } from "./Toast";
import { ActionMenu, type ActionItem } from "./ActionMenu";
import { ConfirmDialog, ContactBadge, EmptyState, IconButton, Modal, Pagination, PotentialBadge, SkeletonRows } from "./ui";
import { WhatsAppButton } from "./WhatsAppButton";

interface Props {
  campaign: Campaign;
  manage?: boolean;
  onChanged?: () => void;
}

const PAGE_SIZE = 25;

/** Lead list of a campaign: filters by contact status, preview panel, per-lead WhatsApp button. */
export function CampaignLeadsBoard({ campaign, manage = false, onChanged }: Props) {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<ContactStatus | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("added");
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [statusLead, setStatusLead] = useState<CampaignLead | null>(null);
  const [removeLead, setRemoveLead] = useState<CampaignLead | null>(null);
  const [adding, setAdding] = useState(false);
  const [addSelection, setAddSelection] = useState<PickerSelection>(emptySelection);
  const [addFilter, setAddFilter] = useState<LeadFilterValues>({});
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload, setData } = useAsync(
    (s) => api.get<Paginated<CampaignLead>>(`/campaigns/${campaign.id}/leads`, { contact_status: statusFilter, q, page, pageSize: PAGE_SIZE, sort, dir: sort === "potential" || sort === "last_contact" ? "desc" : "asc" }, s),
    [campaign.id, statusFilter, q, page, sort],
  );
  const counts = useAsync(
    (s) => api.get<{ byStatus: { status: ContactStatus; total: number }[] }>(`/campaigns/${campaign.id}/results`, undefined, s),
    [campaign.id, data],
  );
  const countFor = (s: ContactStatus | "") =>
    s === "" ? counts.data?.byStatus.reduce((a, b) => a + b.total, 0) ?? 0 : counts.data?.byStatus.find((b) => b.status === s)?.total ?? 0;

  const items = useMemo(() => data?.items ?? [], [data]);
  const sendDisabled = campaign.status === "in_progress" ? null : campaign.status === "completed" ? "Campanha concluída" : "Inicie ou continue a campanha para enviar mensagens";
  const previewIndex = items.findIndex((l) => l.id === previewId);
  const previewLead = previewIndex >= 0 ? items[previewIndex] : null;

  const patch = (leadId: number, p: Partial<CampaignLead>) => setData((d) => (d ? { ...d, items: d.items.map((l) => (l.id === leadId ? { ...l, ...p } : l)) } : d));
  const afterOpen = (leadId: number, current: ContactStatus) => {
    patch(leadId, { campaign_contact_status: current, whatsapp_opened_at: new Date().toISOString(), last_contact_at: new Date().toISOString() });
    counts.reload();
    onChanged?.();
  };

  const nextNotContacted = () => {
    const next = items.find((l, i) => i > previewIndex && l.campaign_contact_status === "not_contacted") ?? items.find((l) => l.campaign_contact_status === "not_contacted");
    if (next) setPreviewId(next.id);
    else toast.show("Nenhum lead não contatado nesta página.");
  };

  const confirmRemove = async () => {
    if (!removeLead) return;
    setBusy(true);
    try {
      await api.del(`/campaigns/${campaign.id}/leads/${removeLead.id}`);
      toast.success("Lead removido da campanha.");
      setRemoveLead(null);
      reload();
      onChanged?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmAdd = async () => {
    if (!selectionCount(addSelection)) return;
    setBusy(true);
    try {
      const r = await api.post<{ added: number }>(`/campaigns/${campaign.id}/leads`, {
        lead_ids: addSelection.mode === "ids" ? [...addSelection.ids] : undefined,
        filter: addSelection.mode === "filter" ? cleanFilter(addSelection.filter) : undefined,
      });
      toast.success(`${fmtNumber(r.added)} lead(s) adicionados.`);
      setAdding(false);
      setAddSelection(emptySelection());
      reload();
      onChanged?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const chips: (ContactStatus | "")[] = ["", ...CONTACT_STATUSES];

  const leadMenu = (lead: CampaignLead): ActionItem[] => [
    { label: "Atualizar status", icon: <ListChecks size={15} />, onClick: () => setStatusLead(lead) },
    { label: "Ver cadastro", icon: <Eye size={15} />, to: `/leads/${lead.id}` },
    { label: "Remover da campanha", icon: <Trash2 size={15} />, onClick: () => setRemoveLead(lead), danger: true, hidden: !manage || campaign.status === "completed" },
  ];

  return (
    <div>
      <div className="chips scroll" role="group" aria-label="Filtrar por status do contato" style={{ marginBottom: 12 }}>
        {chips.map((s) => (
          <button
            key={s || "all"}
            type="button"
            className="chip"
            aria-pressed={statusFilter === s}
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
          >
            {s === "" ? "Todos" : s === "not_contacted" ? "Não contatados" : CONTACT_STATUS_LABELS[s]}
            <span className="count">{countFor(s)}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input className="input grow" type="search" placeholder="Buscar lead na campanha" aria-label="Buscar lead na campanha" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        <select className="select select-auto" aria-label="Ordenação" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="added">Ordem de inclusão</option>
          <option value="name">Nome</option>
          <option value="potential">Maior potencial</option>
          <option value="last_contact">Último contato</option>
          <option value="status">Status</option>
        </select>
        {manage && campaign.status !== "completed" && (
          <button className="btn secondary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Adicionar leads
          </button>
        )}
      </div>
      {sendDisabled && campaign.status !== "completed" && (
        <div className="notice warning" style={{ marginBottom: 12 }}>
          Os botões “Enviar mensagem” ficam disponíveis quando a campanha estiver em andamento.
        </div>
      )}
      {error && <div className="notice danger">{error}</div>}
      {loading && !data ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum lead neste filtro" description={statusFilter ? "Tente outro status." : "Adicione leads à campanha."} />
      ) : (
        <div className="list-view" style={{ opacity: loading ? 0.6 : 1 }}>
          <div className="table-wrap responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Estabelecimento</th>
                  <th>Presença digital</th>
                  <th>Status e potencial</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((lead) => (
                  <tr key={lead.id}>
                    <td className="col-main">
                      <div className="cell-title">{lead.establishment_name}</div>
                      <div className="cell-sub">{[lead.segment, lead.neighborhood, `${lead.city}/${lead.state}`].filter(Boolean).join(" · ")}</div>
                      <div className="cell-sub mono">
                        {fmtPhone(lead.whatsapp, lead.whatsapp_valid === 1)} {lead.whatsapp_valid === 0 && <span className="badge danger">inválido</span>}
                      </div>
                    </td>
                    <td>
                      <PresenceCell url={lead.digital_presence_url} type={lead.digital_presence_type} extraCount={Math.max(0, (lead.links?.length ?? 0) - 1)} />
                    </td>
                    <td>
                      <div className="stack-xs">
                        <button type="button" className="badge-button" onClick={() => setStatusLead(lead)} aria-label={`Alterar status de ${lead.establishment_name}`} data-tooltip="Alterar status">
                          <ContactBadge status={lead.campaign_contact_status} />
                        </button>
                        <PotentialBadge level={lead.potential_level} />
                        <span className="cell-sub">Último contato: {fmtDateTime(lead.last_contact_at)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="actions nowrap">
                        <IconButton label="Ver prévia" onClick={() => setPreviewId(lead.id)}>
                          <Eye size={15} />
                        </IconButton>
                        <WhatsAppButton lead={lead} templates={[campaign.message_template, campaign.message_template_2, campaign.message_template_3]} campaignId={campaign.id} disabledReason={sendDisabled} size="xs" onOpened={(r) => afterOpen(lead.id, r.current)} />
                        <ActionMenu label={`Mais ações: ${lead.establishment_name}`} items={leadMenu(lead)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cards-list">
            {items.map((lead) => (
              <article key={lead.id} className="lead-card" aria-label={lead.establishment_name}>
                <div className="lc-head">
                  <div className="lc-title">
                    <div className="cell-title">{lead.establishment_name}</div>
                    <div className="cell-sub">{lead.segment}</div>
                  </div>
                  <button type="button" className="badge-button" onClick={() => setStatusLead(lead)} aria-label={`Alterar status de ${lead.establishment_name}`}>
                    <ContactBadge status={lead.campaign_contact_status} />
                  </button>
                </div>
                <div className="lc-meta">
                  <span>{[lead.neighborhood, `${lead.city}/${lead.state}`].filter(Boolean).join(" · ")}</span>
                  <span className="mono">{fmtPhone(lead.whatsapp, lead.whatsapp_valid === 1)}</span>
                  <PotentialBadge level={lead.potential_level} />
                  <span className="small muted">Último contato: {fmtDateTime(lead.last_contact_at)}</span>
                </div>
                <PresenceCell url={lead.digital_presence_url} type={lead.digital_presence_type} compact />
                <div className="lc-actions">
                  <WhatsAppButton lead={lead} templates={[campaign.message_template, campaign.message_template_2, campaign.message_template_3]} campaignId={campaign.id} disabledReason={sendDisabled} variant="block" onOpened={(r) => afterOpen(lead.id, r.current)} />
                  <div className="lc-secondary">
                    <button className="btn secondary sm" onClick={() => setPreviewId(lead.id)}>
                      <Eye size={15} /> Ver prévia
                    </button>
                    {lead.digital_presence_url && (
                      <ExternalLink2 url={lead.digital_presence_url}>
                        <ExternalLink size={15} /> Abrir link
                      </ExternalLink2>
                    )}
                    <ActionMenu label={`Mais ações: ${lead.establishment_name}`} items={leadMenu(lead)} />
                  </div>
                </div>
              </article>
            ))}
          </div>
          {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
        </div>
      )}

      <PreviewPanel
        lead={previewLead ? { ...previewLead, contact_status: previewLead.campaign_contact_status } : null}
        campaign={campaign}
        sendDisabledReason={sendDisabled}
        onClose={() => setPreviewId(null)}
        onPrev={previewIndex > 0 ? () => setPreviewId(items[previewIndex - 1].id) : null}
        onNext={previewIndex >= 0 && previewIndex < items.length - 1 ? () => setPreviewId(items[previewIndex + 1].id) : null}
        position={previewIndex >= 0 ? { index: previewIndex, total: items.length } : null}
        onOpened={(current) => previewLead && afterOpen(previewLead.id, current)}
        onEvaluated={reload}
        extraActions={
          <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={nextNotContacted}>
            Ir para o próximo não contatado
          </button>
        }
      />
      {statusLead && (
        <ContactStatusDialog
          open
          leadId={statusLead.id}
          leadName={statusLead.establishment_name}
          campaignId={campaign.id}
          current={statusLead.campaign_contact_status}
          onClose={() => setStatusLead(null)}
          onSaved={(s) => {
            patch(statusLead.id, { campaign_contact_status: s, last_contact_at: new Date().toISOString() });
            counts.reload();
            onChanged?.();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(removeLead)}
        title="Remover lead da campanha?"
        message={`${removeLead?.establishment_name ?? ""} será removido desta campanha. O cadastro do lead e o histórico de contatos são mantidos.`}
        confirmLabel="Remover"
        danger
        busy={busy}
        onCancel={() => setRemoveLead(null)}
        onConfirm={confirmRemove}
      />
      <Modal
        open={adding}
        wide
        title="Adicionar leads à campanha"
        onClose={() => setAdding(false)}
        actions={
          <>
            <button className="btn secondary" onClick={() => setAdding(false)}>
              Cancelar
            </button>
            <button className="btn" disabled={!selectionCount(addSelection) || busy} onClick={confirmAdd}>
              Adicionar {fmtNumber(selectionCount(addSelection))} lead(s)
            </button>
          </>
        }
      >
        <LeadPicker value={addSelection} onChange={setAddSelection} filter={addFilter} onFilterChange={setAddFilter} excludeCampaignId={campaign.id} />
      </Modal>
    </div>
  );
}
