import { useEffect, useState } from "react";
import { CONTACT_STATUSES, CONTACT_STATUS_LABELS, type ContactStatus } from "../../shared/constants";
import { api, errorMessage } from "../lib/api";
import { useToast } from "./Toast";
import { ContactBadge, Field, Modal } from "./ui";

interface Props {
  open: boolean;
  leadId: number;
  leadName: string;
  campaignId?: number | null;
  current: ContactStatus;
  initialStatus?: ContactStatus;
  onClose: () => void;
  onSaved: (status: ContactStatus) => void;
}

/** Manual contact status update with optional note (recorded in the history). */
export function ContactStatusDialog({ open, leadId, leadName, campaignId, current, initialStatus, onClose, onSaved }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<ContactStatus>(initialStatus ?? current);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStatus(initialStatus ?? current);
      setNotes("");
    }
  }, [open, initialStatus, current]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/leads/${leadId}/contact-status`, { status, notes: notes.trim() || null, campaign_id: campaignId ?? null });
      toast.success(`Status atualizado para "${CONTACT_STATUS_LABELS[status]}".`);
      onSaved(status);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Atualizar status do contato"
      description={leadName}
      onClose={onClose}
      actions={
        <>
          <button className="btn secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn" onClick={save} disabled={busy || (status === current && !notes.trim())}>
            {busy ? "Salvando…" : "Salvar status"}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Status atual: <ContactBadge status={current} />
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Novo status" htmlFor="contact-status">
          <select id="contact-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ContactStatus)} data-autofocus>
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONTACT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Observação (opcional)" htmlFor="contact-notes">
          <textarea id="contact-notes" className="textarea" style={{ minHeight: 90 }} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: pediu retorno na segunda-feira." />
        </Field>
      </div>
    </Modal>
  );
}
